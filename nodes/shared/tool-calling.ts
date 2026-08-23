import type { INodeProperties, JsonObject } from 'n8n-workflow';

import type {
	NeedleChainExecution,
	NeedleChainOptions,
	NeedleModelOptions,
	NeedleResponse,
} from '../../runtime/types';

interface ParameterContext {
	getNodeParameter(name: string, itemIndex: number, fallbackValue?: unknown): unknown;
}

interface AdvancedOptions {
	maxSteps?: number;
	maxNewTokens?: number;
	includeMetrics?: boolean;
	detailedOutput?: boolean;
}

export const promptProperty: INodeProperties = {
	displayName: 'Prompt',
	name: 'prompt',
	type: 'string',
	typeOptions: { rows: 4 },
	default: '',
	required: true,
	description: 'Request Needle should complete using the connected tools',
};

export const modelProperties: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'modelSource',
		type: 'options',
		options: [
			{ name: 'Built-In Needle 2', value: 'builtIn' },
			{ name: 'Custom CACT File', value: 'custom' },
		],
		default: 'builtIn',
	},
	{
		displayName: 'Custom Model Path',
		name: 'modelPath',
		type: 'string',
		default: '',
		placeholder: '/models/needle/support.cact',
		description: 'Absolute path under N8N_NEEDLE_MODEL_DIRECTORY',
		displayOptions: { show: { modelSource: ['custom'] } },
	},
	{
		displayName: 'System Facts',
		name: 'system',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		placeholder: 'date: 2026-08-10; locale: en-US',
		description: 'Optional Needle facts such as date, locale, device, or user',
	},
	{
		displayName: 'Minimum Confidence',
		name: 'minimumConfidence',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
		default: 0.8,
		description: 'Stop before executing a call batch below this confidence',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Max Steps',
				name: 'maxSteps',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 32, numberPrecision: 0 },
				default: 1,
				description: 'Number of tool-call batches Needle may execute. Increase this only when later calls must consume earlier tool results.',
			},
			{
				displayName: 'Max New Tokens',
				name: 'maxNewTokens',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 2048 },
				default: 256,
			},
			{
				displayName: 'Include Metrics',
				name: 'includeMetrics',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Detailed Output',
				name: 'detailedOutput',
				type: 'boolean',
				default: false,
				description: 'Whether to include every Needle round and its executed calls',
			},
		],
	},
];

export function getChainOptions(
	context: ParameterContext,
	itemIndex: number,
): NeedleChainOptions {
	const source = context.getNodeParameter('modelSource', itemIndex) as NeedleModelOptions['source'];
	const advancedOptions = getAdvancedOptions(context, itemIndex);
	// Preserve workflows saved before Max Steps moved into the optional collection.
	const legacyMaxSteps = context.getNodeParameter('maxSteps', itemIndex, null) as
		| number
		| null;
	const legacyMaxNewTokens = context.getNodeParameter('maxNewTokens', itemIndex, null) as
		| number
		| null;
	return {
		model: {
			source,
			path:
				source === 'custom'
					? (context.getNodeParameter('modelPath', itemIndex) as string)
					: undefined,
		},
		system: context.getNodeParameter('system', itemIndex, '') as string,
		minimumConfidence: context.getNodeParameter('minimumConfidence', itemIndex, 0.8) as number,
		maxSteps: advancedOptions.maxSteps ?? legacyMaxSteps ?? 1,
		maxNewTokens: advancedOptions.maxNewTokens ?? legacyMaxNewTokens ?? 256,
	};
}

export function getChainOutputOptions(
	context: ParameterContext,
	itemIndex: number,
): { includeMetrics: boolean; detailedOutput: boolean } {
	const advancedOptions = getAdvancedOptions(context, itemIndex);
	const legacyIncludeMetrics = context.getNodeParameter('includeMetrics', itemIndex, null) as
		| boolean
		| null;
	const legacyDetailedOutput = context.getNodeParameter('detailedOutput', itemIndex, null) as
		| boolean
		| null;
	return {
		includeMetrics: advancedOptions.includeMetrics ?? legacyIncludeMetrics ?? false,
		detailedOutput: advancedOptions.detailedOutput ?? legacyDetailedOutput ?? false,
	};
}

function getAdvancedOptions(context: ParameterContext, itemIndex: number): AdvancedOptions {
	return context.getNodeParameter('options', itemIndex, {}) as AdvancedOptions;
}

export function formatChainOutput(
	execution: NeedleChainExecution,
	detailedOutput: boolean,
	includeMetrics: boolean,
): JsonObject {
	const output: JsonObject = {
		...responseEnvelope(execution.finalResponse, includeMetrics),
		definedTools: execution.definedTools as unknown as JsonObject[],
		results: execution.results as unknown as JsonObject[],
		stopReason: execution.stopReason,
	};
	if (detailedOutput) {
		output.query = execution.query;
		output.rounds = execution.rounds.map((round) => ({
			step: round.step,
			input: round.input,
			response: responseEnvelope(round.response, includeMetrics),
			executions: round.executions as unknown as JsonObject[],
		})) as unknown as JsonObject[];
		output.finalResponse = responseEnvelope(execution.finalResponse, includeMetrics);
	}
	return output;
}

function responseEnvelope(response: NeedleResponse, includeMetrics: boolean): JsonObject {
	const output: JsonObject = {
		type: response.type,
		success: response.success,
		error: response.error,
		errorCode: response.errorCode,
		functionCalls: response.functionCalls as unknown as JsonObject[],
		confidence: response.confidence,
	};
	if (response.reasoning !== undefined) output.reasoning = response.reasoning;
	if (response.response !== undefined) output.response = response.response;
	if (response.belowThreshold !== undefined) output.belowThreshold = response.belowThreshold;
	if (includeMetrics) output.metrics = response.metrics as unknown as JsonObject;
	return output;
}
