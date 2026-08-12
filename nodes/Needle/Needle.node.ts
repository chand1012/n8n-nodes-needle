/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- This is intentionally a standalone workflow node. */
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { applyConfidencePolicy } from '../../runtime/confidence';
import { NeedleSchemaError } from '../../runtime/errors';
import { NeedleRuntime } from '../../runtime/NeedleRuntime';
import type {
	JsonSchema,
	LowConfidenceBehavior,
	NeedleModelOptions,
	NeedleResponse,
	NeedleToolDefinition,
} from '../../runtime/types';

export class Needle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle',
		name: 'needle',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Select function calls locally with Needle 2',
		subtitle: 'Function Call Selection',
		defaults: { name: 'Needle' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
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
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '={{ $json.message }}',
				required: true,
			},
			{
				displayName: 'Functions (JSON)',
				name: 'tools',
				type: 'json',
				default: '[]',
				required: true,
				description: 'Functions Needle may call. Provide a JSON array where each function has a name, optional description, and a JSON Schema parameters object. Selected calls are returned in functionCalls on the main output.',
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
			},
			{
				displayName: 'Below Threshold',
				name: 'lowConfidenceBehavior',
				type: 'options',
				options: [
					{ name: 'Mark Low Confidence', value: 'markLowConfidence' },
					{ name: 'Return Empty', value: 'returnEmpty' },
					{ name: 'Return Normally', value: 'returnNormally' },
					{ name: 'Throw Error', value: 'throwError' },
				],
				default: 'markLowConfidence',
			},
			{
				displayName: 'Include Metrics',
				name: 'includeMetrics',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Max New Tokens',
				name: 'maxNewTokens',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 2048 },
				default: 256,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const outputItems: INodeExecutionData[] = [];
		const runtime = NeedleRuntime.getInstance();

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const modelSource = this.getNodeParameter('modelSource', itemIndex) as NeedleModelOptions['source'];
				const model = await runtime.loadModel({
					source: modelSource,
					path: modelSource === 'custom' ? (this.getNodeParameter('modelPath', itemIndex) as string) : undefined,
				});
				const tools = buildTools(this, itemIndex);
				const session = await runtime.createSession(model, {
					tools,
					system: this.getNodeParameter('system', itemIndex, '') as string,
					maxNewTokens: this.getNodeParameter('maxNewTokens', itemIndex, 256) as number,
				});
				const response = await session.complete(this.getNodeParameter('prompt', itemIndex) as string);
				const result = applyConfidencePolicy(
					response,
					this.getNodeParameter('minimumConfidence', itemIndex, 0.8) as number,
					this.getNodeParameter('lowConfidenceBehavior', itemIndex) as LowConfidenceBehavior,
				);
				const includeMetrics = this.getNodeParameter('includeMetrics', itemIndex, false) as boolean;
				outputItems.push({
					json: result ? toNodeOutput(result, includeMetrics) : {},
					pairedItem: itemIndex,
				});
			} catch (error) {
				const nodeError = new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (this.continueOnFail()) {
					outputItems.push({
						json: inputItems[itemIndex].json,
						error: nodeError,
						pairedItem: itemIndex,
					});
					continue;
				}
				throw nodeError;
			}
		}
		return [outputItems];
	}
}

function buildTools(
	context: IExecuteFunctions,
	itemIndex: number,
): NeedleToolDefinition[] {
	const functions = parseTools(context.getNodeParameter('tools', itemIndex, '[]'));
	if (functions.length === 0) {
		throw new NeedleSchemaError(
			'Function Call Selection requires at least one function in Functions (JSON).',
		);
	}
	return functions;
}

function parseTools(value: unknown): NeedleToolDefinition[] {
	const parsed = typeof value === 'string' ? parseJson(value, 'Tools') : value;
	if (!Array.isArray(parsed)) throw new NeedleSchemaError('Functions must be a JSON array.');
	return parsed.map((entry, index) => {
		if (!entry || typeof entry !== 'object') throw new NeedleSchemaError(`Function ${index + 1} must be an object.`);
		const tool = entry as Record<string, unknown>;
		if (typeof tool.name !== 'string' || !tool.name) {
			throw new NeedleSchemaError(`Function ${index + 1} requires a name.`);
		}
		return {
			name: tool.name,
			description: typeof tool.description === 'string' ? tool.description : undefined,
			parameters: parseJsonObject(tool.parameters ?? {}, `Function ${tool.name} parameters`),
		};
	});
}

function parseJsonObject(value: unknown, label: string): JsonSchema {
	const parsed = typeof value === 'string' ? parseJson(value, label) : value;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NeedleSchemaError(`${label} must be a JSON object.`);
	}
	return parsed as JsonSchema;
}

function parseJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new NeedleSchemaError(`${label} contains invalid JSON.`, { cause: error });
	}
}

function toNodeOutput(response: NeedleResponse, includeMetrics: boolean): JsonObject {
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
