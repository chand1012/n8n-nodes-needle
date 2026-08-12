/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- This is intentionally a standalone workflow node. */
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeOutputConfiguration,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { NeedleRuntime } from '../../runtime/NeedleRuntime';
import type {
	NeedleModelOptions,
	NeedleResponse,
	NeedleToolDefinition,
} from '../../runtime/types';

export interface NeedleCategory {
	category: string;
	description?: string;
}

interface ClassifierOptions extends IDataObject {
	multiClass?: boolean;
	fallback?: 'discard' | 'other';
	minimumConfidence?: number;
	includeToolCalls?: boolean;
	includeMetrics?: boolean;
	toolCallsOutputField?: string;
	maxNewTokens?: number;
}

interface ClassifierParameters extends IDataObject {
	categories?: { categories?: NeedleCategory[] };
	options?: ClassifierOptions;
}

const configuredOutputs = (parameters: ClassifierParameters): INodeOutputConfiguration[] => {
	const categories = parameters.categories?.categories ?? [];
	const outputs: INodeOutputConfiguration[] = categories.map(({ category }) => ({
		type: 'main',
		displayName: category,
	}));
	if (parameters.options?.fallback === 'other') {
		outputs.push({ type: 'main', displayName: 'Other' });
	}
	return outputs;
};

export class NeedleTextClassifier implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle Text Classifier',
		name: 'needleTextClassifier',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Classify text locally with the embedded Needle model',
		defaults: { name: 'Needle Text Classifier' },
		subtitle: '={{$parameter["modelSource"] === "custom" ? "Custom CACT" : "Built-In Needle 2"}}',
		inputs: [NodeConnectionTypes.Main],
		outputs: `={{(${configuredOutputs})($parameter)}}`,
		properties: [
			{
				displayName: 'Text to Classify',
				name: 'inputText',
				type: 'string',
				required: true,
				default: '',
				description: 'Use an expression to reference data in previous nodes or enter static text',
				typeOptions: { rows: 2 },
			},
			{
				displayName: 'Categories',
				name: 'categories',
				placeholder: 'Add Category',
				type: 'fixedCollection',
				default: {},
				typeOptions: { multipleValues: true },
				options: [
					{
						name: 'categories',
						displayName: 'Categories',
						values: [
							{
								displayName: 'Category',
								name: 'category',
								type: 'string',
								default: '',
								description: 'Category to add',
								required: true,
							},
							{
								displayName: 'Description',
								name: 'description',
								type: 'string',
								default: '',
								description: "Describe your category if it's not obvious",
							},
						],
					},
				],
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
				placeholder: '/models/needle/classifier.cact',
				description: 'Absolute path under N8N_NEEDLE_MODEL_DIRECTORY',
				displayOptions: { show: { modelSource: ['custom'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'Allow Multiple Classes To Be True',
						name: 'multiClass',
						type: 'boolean',
						default: false,
					},
					{
						displayName: 'Include Metrics',
						name: 'includeMetrics',
						type: 'boolean',
						default: false,
						description: 'Whether to include Needle runtime and throughput metrics in the tool-call output record',
						displayOptions: { show: { includeToolCalls: [true] } },
					},
					{
						displayName: 'Include Tool Calls in Output',
						name: 'includeToolCalls',
						type: 'boolean',
						default: false,
						description: 'Whether to add the generated tools, returned calls, input text, and confidence to each routed item for copying or synthetic-data collection',
					},
					{
						displayName: 'Max New Tokens',
						name: 'maxNewTokens',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 2048 },
						default: 256,
					},
					{
						displayName: 'Minimum Confidence',
						name: 'minimumConfidence',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 0.3,
						description: 'Route results below this confidence through the no-clear-match behavior',
					},
					{
						displayName: 'Tool Calls Output Field',
						name: 'toolCallsOutputField',
						type: 'string',
						default: 'needleClassification',
						description: 'Field that receives the synthetic classification record',
						displayOptions: { show: { includeToolCalls: [true] } },
					},
					{
						displayName: 'When No Clear Match',
						name: 'fallback',
						type: 'options',
						default: 'discard',
						description: 'What to do when Needle returns no category or falls below the confidence threshold',
						options: [
							{
								name: 'Discard Item',
								value: 'discard',
								description: 'Ignore the item and drop it from the output',
							},
							{
								name: "Output on Extra, 'Other' Branch",
								value: 'other',
								description: "Create a separate output branch called 'Other'",
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const categories = getCategories(this, 0);
		if (categories.length === 0) {
			throw new NodeOperationError(this.getNode(), 'At least one category must be defined');
		}

		const options = this.getNodeParameter('options', 0, {}) as ClassifierOptions;
		const fallback = options.fallback ?? 'discard';
		const outputCount = categories.length + (fallback === 'other' ? 1 : 0);
		const returnData: INodeExecutionData[][] = Array.from({ length: outputCount }, () => []);
		const tools = buildCategoryTools(categories, options.multiClass ?? false);
		const runtime = NeedleRuntime.getInstance();
		const modelSource = this.getNodeParameter('modelSource', 0) as NeedleModelOptions['source'];
		const model = await runtime.loadModel({
			source: modelSource,
			path: modelSource === 'custom' ? (this.getNodeParameter('modelPath', 0) as string) : undefined,
		});

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputText = this.getNodeParameter('inputText', itemIndex) as string;
				if (!inputText) {
					throw new NodeOperationError(this.getNode(), `Text to classify for item ${itemIndex} is not defined`, {
						itemIndex,
					});
				}
				const session = await runtime.createSession(model, {
					tools,
					maxNewTokens: options.maxNewTokens ?? 256,
				});
				const response = await session.complete(formatClassifierInput(inputText));
				const categoryIndexes = selectCategoryIndexes(
					response,
					categories,
					options.multiClass ?? false,
					options.minimumConfidence ?? 0.3,
				);
				const routedItem = createRoutedItem(items[itemIndex], itemIndex, inputText, tools, response, options);

				if (categoryIndexes.length > 0) {
					for (const categoryIndex of categoryIndexes) {
						returnData[categoryIndex].push(cloneExecutionItem(routedItem));
					}
				} else if (fallback === 'other') {
					returnData[returnData.length - 1].push(routedItem);
				}
			} catch (error) {
				const executionError = new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (this.continueOnFail()) {
					returnData[0].push({
						json: { ...items[itemIndex].json, error: executionError.message },
						binary: items[itemIndex].binary,
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw executionError;
			}
		}

		return returnData;
	}
}

function getCategories(context: IExecuteFunctions, itemIndex: number): NeedleCategory[] {
	const value = context.getNodeParameter('categories.categories', itemIndex, []) as NeedleCategory[];
	return value.map(({ category, description }) => ({
		category: category.trim(),
		description: description?.trim(),
	})).filter(({ category }) => category.length > 0);
}

export function buildCategoryTools(
	categories: NeedleCategory[],
	multiClass = false,
): NeedleToolDefinition[] {
	const categoryList = categories
		.map(({ category, description }) => `- ${category}: ${description || 'No description provided'}`)
		.join('\n');
	const multipleCallGuidance = multiClass
		? ' When more than one category applies, call this function once for each applicable category.'
		: '';
	return [
		{
			name: 'classify',
			description: `Classifies text into a category.${multipleCallGuidance}\n\nCategories:\n${categoryList}`,
			parameters: {
				type: 'object',
				properties: {
					text: {
						type: 'string',
						description: 'The supplied text to classify',
					},
					category: {
						type: 'string',
						description: 'The category that applies to the text',
						enum: categories.map(({ category }) => category),
					},
				},
				required: ['text', 'category'],
				additionalProperties: false,
			},
		},
	];
}

export function selectCategoryIndexes(
	response: NeedleResponse,
	categories: NeedleCategory[],
	multiClass: boolean,
	minimumConfidence: number,
): number[] {
	if (!response.success || response.confidence < minimumConfidence) return [];
	const indexes: number[] = [];
	for (const call of response.functionCalls) {
		if (call.name !== 'classify' || typeof call.arguments.category !== 'string') continue;
		const selectedCategory = call.arguments.category.trim().toLowerCase();
		const index = categories.findIndex(
			({ category }) => category.trim().toLowerCase() === selectedCategory,
		);
		if (index < 0 || indexes.includes(index)) continue;
		indexes.push(index);
		if (!multiClass) break;
	}
	return indexes;
}

export function formatClassifierInput(inputText: string): string {
	return `The text to classify is: ${JSON.stringify(inputText)}`;
}

function createRoutedItem(
	item: INodeExecutionData,
	itemIndex: number,
	inputText: string,
	tools: NeedleToolDefinition[],
	response: NeedleResponse,
	options: ClassifierOptions,
): INodeExecutionData {
	const json: IDataObject = { ...item.json };
	if (options.includeToolCalls) {
		const field = options.toolCallsOutputField?.trim() || 'needleClassification';
		json[field] = createClassificationRecord(
			inputText,
			tools,
			response,
			options.minimumConfidence ?? 0.3,
			options.includeMetrics ?? false,
		);
	}
	return {
		json,
		binary: item.binary,
		pairedItem: { item: itemIndex },
	};
}

export function createClassificationRecord(
	inputText: string,
	tools: NeedleToolDefinition[],
	response: NeedleResponse,
	minimumConfidence: number,
	includeMetrics: boolean,
): JsonObject {
	const record: JsonObject = {
		input: inputText,
		tools: tools as unknown as JsonObject[],
		toolCalls: response.functionCalls as unknown as JsonObject[],
		confidence: response.confidence,
		belowThreshold: response.confidence < minimumConfidence,
	};
	if (includeMetrics) record.metrics = response.metrics as unknown as JsonObject;
	return record;
}

function cloneExecutionItem(item: INodeExecutionData): INodeExecutionData {
	return {
		...item,
		json: { ...item.json },
	};
}
