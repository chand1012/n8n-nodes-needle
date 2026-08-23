import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AsyncMutex } from './AsyncMutex';
import {
	NeedleInferenceError,
	NeedleInitializationError,
	NeedleModelLoadError,
} from './errors';
import { NeedleModelManager, type NeedleModelManagerOptions } from './NeedleModelManager';
import { NeedleSession } from './NeedleSession';
import type {
	NeedleFunctionCall,
	NeedleModel,
	NeedleModelOptions,
	NeedleResponse,
	NeedleSessionOptions,
} from './types';

interface EmscriptenNeedleModule {
	HEAPU8: Uint8Array;
	_malloc(size: number): number;
	_free(pointer: number): void;
	_needle_load(pointer: number, length: bigint): number;
	cwrap(
		name: string,
		returnType: 'number' | null,
		argumentTypes: Array<'string' | 'number'>,
	): (...args: Array<string | number | null>) => number;
	UTF8ToString(pointer: number): string;
}

type NeedleModuleFactory = (options: { wasmBinary: Uint8Array }) => Promise<EmscriptenNeedleModule>;

interface RuntimeFunctions {
	init(system: string, toolsJson: string, toolIndexPath: null): number;
	complete(input: string, maxNewTokens: number, outputPointer: number, outputCapacity: number): number;
	reset(): number;
}

export interface NeedleRuntimeOptions extends NeedleModelManagerOptions {
	debug?: boolean;
	loaderPath?: string;
	wasmPath?: string;
}

export class NeedleRuntime {
	private static singleton?: NeedleRuntime;
	private readonly mutex = new AsyncMutex();
	private readonly modelManager: NeedleModelManager;
	private readonly debug: boolean;
	private readonly loaderPath: string;
	private readonly wasmPath: string;
	private initialization?: Promise<void>;
	private module?: EmscriptenNeedleModule;
	private functions?: RuntimeFunctions;
	private activeModelKey?: string;
	private activeModelPointer?: number;
	private initializationMs = 0;

	constructor(options: NeedleRuntimeOptions = {}) {
		this.modelManager = new NeedleModelManager(options);
		this.debug = options.debug ?? process.env.N8N_NEEDLE_DEBUG === 'true';
		this.loaderPath = options.loaderPath ?? path.join(__dirname, 'wasm', 'needle.js');
		this.wasmPath = options.wasmPath ?? path.join(__dirname, 'wasm', 'needle.wasm');
	}

	static getInstance(): NeedleRuntime {
		this.singleton ??= new NeedleRuntime();
		return this.singleton;
	}

	async initialize(): Promise<void> {
		this.initialization ??= this.initializeInternal();
		return await this.initialization;
	}

	async loadModel(options: NeedleModelOptions): Promise<NeedleModel> {
		return await this.modelManager.load(options);
	}

	async createSession(
		model: NeedleModel,
		options: NeedleSessionOptions = {},
	): Promise<NeedleSession> {
		await this.initialize();
		return new NeedleSession(this, model, options);
	}

	async execute(session: NeedleSession, inputs: string[]): Promise<NeedleResponse> {
		return await this.runSession(session, async (complete) => {
			let response: NeedleResponse | undefined;
			for (const input of inputs) response = complete(input);
			if (!response) throw new NeedleInferenceError('Needle did not produce a response.');
			return response;
		});
	}

	async runSession<T>(
		session: NeedleSession,
		callback: (complete: (input: string) => NeedleResponse) => Promise<T>,
	): Promise<T> {
		return await this.mutex.runExclusive(async () => {
			await this.initialize();
			const module = this.requireModule();
			const functions = this.requireFunctions();

			await this.activateModel(session.model, module);
			const tools = session.options.tools ?? [];
			this.log(`initializing session with ${tools.length} tool(s)`);
			const initialized = functions.init(
				session.options.system ?? '',
				JSON.stringify(tools),
				null,
			);
			if (initialized < 0) throw new NeedleInferenceError('Needle session initialization failed.');

			const complete = (input: string): NeedleResponse => {
				const startedAt = performance.now();
				const raw = this.completeInternal(
					input,
					session.options.maxNewTokens ?? 256,
					session.options.outputBufferBytes ?? 65_536,
					module,
					functions,
				);
				const durationMs = performance.now() - startedAt;
				const response = this.normalizeResponse(
					raw,
					durationMs,
					session.model.loadTimeMs,
					tools.length,
				);
				this.log(
					`inference completed in ${durationMs.toFixed(1)}ms confidence=${response.confidence}`,
				);
				return response;
			};
			return await callback(complete);
		});
	}

	private async initializeInternal(): Promise<void> {
		const startedAt = performance.now();
		this.log('initializing WASM runtime');
		try {
			const [wasmBuffer] = await Promise.all([fs.readFile(this.wasmPath), fs.access(this.loaderPath)]);
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const imported = require(this.loaderPath) as NeedleModuleFactory | { default: NeedleModuleFactory };
			const factory = typeof imported === 'function' ? imported : imported.default;
			this.module = await factory({
				wasmBinary: new Uint8Array(wasmBuffer.buffer, wasmBuffer.byteOffset, wasmBuffer.byteLength),
			});
			this.functions = {
				init: this.module.cwrap('needle_init', 'number', ['string', 'string', 'string']) as RuntimeFunctions['init'],
				complete: this.module.cwrap('needle_complete', 'number', [
					'string',
					'number',
					'number',
					'number',
				]) as RuntimeFunctions['complete'],
				reset: this.module.cwrap('needle_reset', null, []) as RuntimeFunctions['reset'],
			};
			this.initializationMs = performance.now() - startedAt;
			this.log(`runtime initialized in ${this.initializationMs.toFixed(1)}ms`);
		} catch (error) {
			this.initialization = undefined;
			throw new NeedleInitializationError('The Needle WASM runtime could not be initialized.', {
				cause: error,
			});
		}
	}

	private async activateModel(model: NeedleModel, module: EmscriptenNeedleModule): Promise<void> {
		if (this.activeModelKey === model.key) return;
		this.log(`loading ${path.basename(model.path)}`);
		const pointer = module._malloc(model.bytes.byteLength);
		if (!pointer) throw new NeedleModelLoadError('Needle could not allocate memory for the model.');
		try {
			module.HEAPU8.set(model.bytes, pointer);
			const result = module._needle_load(pointer, BigInt(model.bytes.byteLength));
			if (result !== 0) {
				throw new NeedleModelLoadError(`Needle model \`${model.path}\` could not be loaded.`);
			}
			// The WASM engine keeps zero-copy views into the CACT buffer. Retain the
			// allocation for as long as this model is active; otherwise a later malloc
			// (usually the completion output buffer) can overwrite the model weights.
			if (this.activeModelPointer !== undefined) module._free(this.activeModelPointer);
			this.activeModelPointer = pointer;
			this.activeModelKey = model.key;
		} catch (error) {
			module._free(pointer);
			throw error;
		}
	}

	private completeInternal(
		input: string,
		maxNewTokens: number,
		outputCapacity: number,
		module: EmscriptenNeedleModule,
		functions: RuntimeFunctions,
	): Record<string, unknown> {
		const outputPointer = module._malloc(outputCapacity);
		if (!outputPointer) throw new NeedleInferenceError('Needle could not allocate an output buffer.');
		module.HEAPU8.fill(0, outputPointer, outputPointer + outputCapacity);
		try {
			const result = functions.complete(input, maxNewTokens, outputPointer, outputCapacity);
			if (result < 0) throw new NeedleInferenceError(`Needle inference failed with code ${result}.`);
			const output = module.UTF8ToString(outputPointer);
			try {
				return JSON.parse(output) as Record<string, unknown>;
			} catch (error) {
				throw new NeedleInferenceError('Needle returned malformed JSON.', { cause: error });
			}
		} catch (error) {
			if (error instanceof NeedleInferenceError) throw error;
			throw new NeedleInferenceError('Needle inference failed.', { cause: error });
		} finally {
			module._free(outputPointer);
		}
	}

	private normalizeResponse(
		raw: Record<string, unknown>,
		durationMs: number,
		modelLoadMs: number,
		toolCount: number,
	): NeedleResponse {
		const rawCalls = Array.isArray(raw.function_calls) ? raw.function_calls : [];
		const functionCalls: NeedleFunctionCall[] = rawCalls.flatMap((entry) => {
			if (!entry || typeof entry !== 'object') return [];
			const call = entry as Record<string, unknown>;
			if (typeof call.name !== 'string') return [];
			return [{
				name: call.name,
				arguments:
					call.arguments && typeof call.arguments === 'object'
						? (call.arguments as Record<string, unknown>)
						: {},
			}];
		});
		return {
			type: typeof raw.type === 'string' ? raw.type : 'respond',
			success: raw.success !== false,
			error: typeof raw.error === 'string' ? raw.error : null,
			errorCode: typeof raw.error_code === 'string' ? raw.error_code : null,
			functionCalls,
			reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
			response:
				typeof raw.response === 'string'
					? raw.response
					: typeof raw.content === 'string'
						? raw.content
						: typeof raw.message === 'string'
							? raw.message
							: undefined,
			confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
			metrics: {
				durationMs,
				wasmInitializationMs: this.initializationMs,
				modelLoadMs,
				prefillTokensPerSecond:
					typeof raw.prefill_tps === 'number' ? raw.prefill_tps : undefined,
				decodeTokensPerSecond:
					typeof raw.decode_tps === 'number' ? raw.decode_tps : undefined,
				toolCount,
			},
			raw,
		};
	}

	private requireModule(): EmscriptenNeedleModule {
		if (!this.module) throw new NeedleInitializationError('Needle has not been initialized.');
		return this.module;
	}

	private requireFunctions(): RuntimeFunctions {
		if (!this.functions) throw new NeedleInitializationError('Needle has not been initialized.');
		return this.functions;
	}

	private log(message: string): void {
		// eslint-disable-next-line no-console
		if (this.debug) console.debug(`[needle] ${message}`);
	}
}
