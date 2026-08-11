import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NeedleModelLoadError, NeedleModelNotFoundError } from './errors';
import type { NeedleModel, NeedleModelOptions } from './types';

export interface NeedleModelManagerOptions {
	builtInModelPath?: string;
	modelDirectory?: string;
	allowUnrestrictedModels?: boolean;
}

export class NeedleModelManager {
	private readonly cache = new Map<string, Promise<NeedleModel>>();
	private readonly builtInModelPath: string;
	private readonly modelDirectory?: string;
	private readonly allowUnrestrictedModels: boolean;

	constructor(options: NeedleModelManagerOptions = {}) {
		this.builtInModelPath = options.builtInModelPath ?? path.join(__dirname, 'wasm', 'default.cact');
		this.modelDirectory = options.modelDirectory ?? process.env.N8N_NEEDLE_MODEL_DIRECTORY;
		this.allowUnrestrictedModels =
			options.allowUnrestrictedModels ?? process.env.N8N_NEEDLE_ALLOW_UNRESTRICTED_MODELS === 'true';
	}

	async load(options: NeedleModelOptions): Promise<NeedleModel> {
		const builtIn = options.source === 'builtIn';
		const modelPath = builtIn ? this.builtInModelPath : await this.validateCustomPath(options.path);
		let stats;
		try {
			stats = await fs.stat(modelPath);
		} catch (error) {
			throw new NeedleModelNotFoundError(`Needle model \`${modelPath}\` could not be found.`, {
				cause: error,
			});
		}
		if (!stats.isFile()) {
			throw new NeedleModelNotFoundError(`Needle model \`${modelPath}\` is not a file.`);
		}

		const key = `${modelPath}:${stats.size}:${stats.mtimeMs}`;
		const cached = this.cache.get(key);
		if (cached) return await cached;

		const loading = this.readModel(modelPath, key, builtIn, stats.mtimeMs);
		this.cache.set(key, loading);
		try {
			return await loading;
		} catch (error) {
			this.cache.delete(key);
			throw error;
		}
	}

	private async validateCustomPath(requestedPath?: string): Promise<string> {
		if (!requestedPath) throw new NeedleModelNotFoundError('A custom Needle model path is required.');
		if (path.extname(requestedPath).toLowerCase() !== '.cact') {
			throw new NeedleModelLoadError('Custom Needle models must use the .cact extension.');
		}

		let canonicalPath: string;
		try {
			canonicalPath = await fs.realpath(path.resolve(requestedPath));
		} catch (error) {
			throw new NeedleModelNotFoundError(`Needle model \`${requestedPath}\` could not be found.`, {
				cause: error,
			});
		}

		if (this.allowUnrestrictedModels) return canonicalPath;
		if (!this.modelDirectory) {
			throw new NeedleModelLoadError(
				'Custom models are disabled until N8N_NEEDLE_MODEL_DIRECTORY is configured.',
			);
		}

		let canonicalRoot: string;
		try {
			canonicalRoot = await fs.realpath(path.resolve(this.modelDirectory));
		} catch (error) {
			throw new NeedleModelLoadError(
				`Needle model directory \`${this.modelDirectory}\` could not be resolved.`,
				{ cause: error },
			);
		}
		if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) {
			throw new NeedleModelLoadError(
				`Needle model \`${requestedPath}\` is outside N8N_NEEDLE_MODEL_DIRECTORY.`,
			);
		}
		return canonicalPath;
	}

	private async readModel(
		modelPath: string,
		key: string,
		builtIn: boolean,
		mtimeMs: number,
	): Promise<NeedleModel> {
		const startedAt = performance.now();
		try {
			const buffer = await fs.readFile(modelPath);
			return {
				key,
				path: modelPath,
				bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
				builtIn,
				mtimeMs,
				loadTimeMs: performance.now() - startedAt,
			};
		} catch (error) {
			throw new NeedleModelLoadError(`Needle model \`${modelPath}\` could not be loaded.`, {
				cause: error,
			});
		}
	}
}
