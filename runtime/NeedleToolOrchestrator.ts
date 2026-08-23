import type { ConnectedNeedleTool } from '../langchain/connected-tool-adapter';
import { NeedleInferenceError, NeedleToolCallError } from './errors';
import { NeedleRuntime } from './NeedleRuntime';
import type {
	NeedleChainExecution,
	NeedleChainOptions,
	NeedleChainRound,
	NeedleResponse,
	NeedleSerializableValue,
} from './types';

export class NeedleToolOrchestrator {
	constructor(private readonly runtime = NeedleRuntime.getInstance()) {}

	async run(
		query: string,
		tools: ConnectedNeedleTool[],
		options: NeedleChainOptions,
	): Promise<NeedleChainExecution> {
		if (!query.trim()) throw new NeedleInferenceError('Needle Tool Calling requires a prompt.');
		if (tools.length === 0) throw new NeedleInferenceError('Needle Tool Calling requires tools.');

		const minimumConfidence = options.minimumConfidence ?? 0.8;
		const maxSteps = options.maxSteps ?? 1;
		const model = await this.runtime.loadModel(options.model);
		const definedTools = tools.map(({ definition }) => definition);
		const session = await this.runtime.createSession(model, {
			tools: definedTools,
			system: options.system ?? '',
			maxNewTokens: options.maxNewTokens ?? 256,
		});

		return await session.run(async (complete) => {
			const results: NeedleSerializableValue[] = [];
			const rounds: NeedleChainRound[] = [];
			let input = query;
			let response = complete(input);

			for (let step = 1; ; step++) {
				const round: NeedleChainRound = { step, input, response, executions: [] };
				rounds.push(round);
				if (!response.success) {
					throw new NeedleInferenceError(
						response.error ?? `Needle returned an unsuccessful response at step ${step}.`,
					);
				}
				if (response.type !== 'call' || response.functionCalls.length === 0) {
					return buildExecution(query, definedTools, results, rounds, response, 'completed');
				}
				if (step > maxSteps) {
					return buildExecution(query, definedTools, results, rounds, response, 'maxSteps');
				}
				if (response.confidence < minimumConfidence) {
					response = { ...response, belowThreshold: true };
					round.response = response;
					return buildExecution(query, definedTools, results, rounds, response, 'lowConfidence');
				}
				const batchResults: NeedleSerializableValue[] = [];
				for (let callIndex = 0; callIndex < response.functionCalls.length; callIndex++) {
					const call = response.functionCalls[callIndex];
					const tool = tools.find(({ definition }) => definition.name === call.name);
					if (!tool) {
						throw toolCallError(step, callIndex, call.name, 'Needle selected an unknown tool.');
					}
					try {
						const result = await tool.invoke(call.arguments);
						batchResults.push(result);
						results.push(result);
						round.executions.push({ ...call, result });
					} catch (error) {
						throw toolCallError(step, callIndex, call.name, (error as Error).message, error);
					}
				}

				// Needle's showcased complete() behavior is one inference returning one
				// ordered call batch. Execute that batch and return its native envelope
				// without adding a result-fed inference unless the user opts into chaining.
				if (maxSteps === 1) {
					return buildExecution(query, definedTools, results, rounds, response, 'completed');
				}

				input = JSON.stringify(batchResults);
				response = complete(input);
			}
		});
	}
}

function buildExecution(
	query: string,
	definedTools: NeedleChainExecution['definedTools'],
	results: NeedleSerializableValue[],
	rounds: NeedleChainRound[],
	finalResponse: NeedleResponse,
	stopReason: NeedleChainExecution['stopReason'],
): NeedleChainExecution {
	return { query, definedTools, results, rounds, finalResponse, stopReason };
}

function toolCallError(
	step: number,
	callIndex: number,
	toolName: string,
	message: string,
	cause?: unknown,
): NeedleToolCallError {
	return new NeedleToolCallError(
		`Needle tool call failed at step ${step}, call ${callIndex + 1} (\`${toolName}\`): ${message}`,
		cause instanceof Error ? { cause } : undefined,
	);
}
