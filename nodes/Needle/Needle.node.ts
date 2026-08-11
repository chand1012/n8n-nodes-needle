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

type NeedleOperation = 'toolSelection' | 'structuredExtraction' | 'classification' | 'complete';

export class Needle implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle',
		name: 'needle',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Run local Needle 2 tool selection and structured extraction',
		subtitle: '={{$parameter["operation"]}}',
		defaults: { name: 'Needle' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Classification', value: 'classification', description: 'Choose a label from a fixed list', action: 'Classify text' },
					{ name: 'Complete', value: 'complete', description: 'Call the underlying Needle completion interface', action: 'Complete a prompt' },
					{ name: 'Structured Extraction', value: 'structuredExtraction', description: 'Extract data constrained by JSON Schema', action: 'Extract structured data' },
					{ name: 'Tool Selection', value: 'toolSelection', description: 'Choose one or more tools and arguments', action: 'Select tools' },
				],
				default: 'toolSelection',
			},
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
				displayName: 'Tools (JSON)',
				name: 'tools',
				type: 'json',
				default: '[]',
				description: 'Array of OpenAI-style tools with name, description, and JSON Schema parameters',
				displayOptions: { show: { operation: ['toolSelection', 'complete'] } },
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				default: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
				displayOptions: { show: { operation: ['structuredExtraction'] } },
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: { values: [{ label: '' }] },
				options: [
					{
						displayName: 'Label',
						name: 'values',
						values: [{ displayName: 'Label', name: 'label', type: 'string', default: '' }],
					},
				],
				displayOptions: { show: { operation: ['classification'] } },
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
				const operation = this.getNodeParameter('operation', itemIndex) as NeedleOperation;
				const modelSource = this.getNodeParameter('modelSource', itemIndex) as NeedleModelOptions['source'];
				const model = await runtime.loadModel({
					source: modelSource,
					path: modelSource === 'custom' ? (this.getNodeParameter('modelPath', itemIndex) as string) : undefined,
				});
				const tools = buildTools(this, itemIndex, operation);
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
	operation: NeedleOperation,
): NeedleToolDefinition[] {
	if (operation === 'structuredExtraction') {
		const schema = parseJsonObject(context.getNodeParameter('jsonSchema', itemIndex), 'JSON Schema');
		return [{ name: 'extract', description: 'Extract the requested structured data', parameters: schema }];
	}
	if (operation === 'classification') {
		const labelValue = context.getNodeParameter('labels', itemIndex, {}) as {
			values?: Array<{ label?: string }>;
		};
		const labels = (labelValue.values ?? []).map(({ label }) => label?.trim()).filter(Boolean) as string[];
		if (labels.length < 2) throw new NeedleSchemaError('Classification requires at least two labels.');
		return [{
			name: 'classify',
			description: 'Classify the input into exactly one label',
			parameters: {
				type: 'object',
				properties: { label: { type: 'string', enum: labels } },
				required: ['label'],
				additionalProperties: false,
			},
		}];
	}
	return parseTools(context.getNodeParameter('tools', itemIndex, '[]'));
}

function parseTools(value: unknown): NeedleToolDefinition[] {
	const parsed = typeof value === 'string' ? parseJson(value, 'Tools') : value;
	if (!Array.isArray(parsed)) throw new NeedleSchemaError('Tools must be a JSON array.');
	return parsed.map((entry, index) => {
		if (!entry || typeof entry !== 'object') throw new NeedleSchemaError(`Tool ${index + 1} must be an object.`);
		const tool = entry as Record<string, unknown>;
		if (typeof tool.name !== 'string' || !tool.name) {
			throw new NeedleSchemaError(`Tool ${index + 1} requires a name.`);
		}
		return {
			name: tool.name,
			description: typeof tool.description === 'string' ? tool.description : undefined,
			parameters: parseJsonObject(tool.parameters ?? {}, `Tool ${tool.name} parameters`),
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
