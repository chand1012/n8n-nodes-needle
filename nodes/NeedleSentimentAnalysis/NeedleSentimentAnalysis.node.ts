/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- This is intentionally a standalone workflow node. */
import { setTimeout as sleep } from 'node:timers/promises';

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
	NeedleMetrics,
	NeedleModelOptions,
	NeedleResponse,
	NeedleToolDefinition,
} from '../../runtime/types';

const DEFAULT_CATEGORIES = 'Positive, Neutral, Negative';
const DEFAULT_PROMPT_TEMPLATE =
	'Analyzes the sentiment of supplied text and categorizes it as one of: {categories}.';

interface BatchingOptions extends IDataObject {
	batchSize?: number;
	delayBetweenBatches?: number;
}

interface SentimentOptions extends IDataObject {
	batching?: BatchingOptions;
	categories?: string;
	fallback?: 'discard' | 'other';
	includeDetailedResults?: boolean;
	includeMetrics?: boolean;
	includeToolCalls?: boolean;
	maxNewTokens?: number;
	minimumConfidence?: number;
	systemPromptTemplate?: string;
	toolCallsOutputField?: string;
}

interface SentimentParameters extends IDataObject {
	options?: SentimentOptions;
}

const configuredOutputs = (
	parameters: SentimentParameters,
	defaultCategories: string,
): INodeOutputConfiguration[] => {
	const options = parameters.options ?? {};
	const categories = (options.categories ?? defaultCategories)
		.split(',')
		.map((category) => category.trim())
		.filter(Boolean);
	const outputs: INodeOutputConfiguration[] = categories.map((category) => ({
		type: 'main',
		displayName: category,
	}));
	if (options.fallback === 'other') outputs.push({ type: 'main', displayName: 'Other' });
	return outputs;
};

export class NeedleSentimentAnalysis implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle Sentiment Analysis',
		name: 'needleSentimentAnalysis',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Analyze sentiment locally with the embedded Needle model',
		defaults: { name: 'Needle Sentiment Analysis' },
		subtitle: '={{$parameter["modelSource"] === "custom" ? "Custom CACT" : "Built-In Needle 2"}}',
		inputs: [NodeConnectionTypes.Main],
		outputs: `={{(${configuredOutputs})($parameter, "${DEFAULT_CATEGORIES}")}}`,
		properties: [
			{
				displayName: 'Text to Analyze',
				name: 'inputText',
				type: 'string',
				required: true,
				default: '',
				description: 'Use an expression to reference data in previous nodes or enter static text',
				typeOptions: { rows: 2 },
			},
			{
				displayName: 'Sentiment scores are model-generated estimates, not statistically rigorous measurements. They should be used as rough indicators only.',
				name: 'detailedResultsNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { '/options.includeDetailedResults': [true] } },
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
				placeholder: '/models/needle/sentiment.cact',
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
						displayName: 'Batch Processing',
						name: 'batching',
						type: 'collection',
						placeholder: 'Add Batch Processing Option',
						description: 'Control item grouping and delay between groups',
						default: {},
						options: [
							{
								displayName: 'Batch Size',
								name: 'batchSize',
								type: 'number',
								default: 5,
								typeOptions: { minValue: 1 },
								description: 'Number of items to process before applying the batch delay',
							},
							{
								displayName: 'Delay Between Batches',
								name: 'delayBetweenBatches',
								type: 'number',
								default: 0,
								typeOptions: { minValue: 0 },
								description: 'Delay in milliseconds between batches',
							},
						],
					},
					{
						displayName: 'Include Detailed Results',
						name: 'includeDetailedResults',
						type: 'boolean',
						default: false,
						description: 'Whether to include sentiment strength and Needle confidence in the output',
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
						description: 'Whether to add the generated tools, returned calls, input text, and confidence to each routed item',
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
						displayName: 'Sentiment Categories',
						name: 'categories',
						type: 'string',
						default: DEFAULT_CATEGORIES,
						description: 'A comma-separated list of categories to analyze',
						noDataExpression: true,
						typeOptions: { rows: 2 },
					},
					{
						displayName: 'System Prompt Template',
						name: 'systemPromptTemplate',
						type: 'string',
						default: DEFAULT_PROMPT_TEMPLATE,
						description: 'Template used as the sentiment function description; {categories} is replaced with the configured list',
						typeOptions: { rows: 6 },
					},
					{
						displayName: 'Tool Calls Output Field',
						name: 'toolCallsOutputField',
						type: 'string',
						default: 'needleSentiment',
						description: 'Field that receives the sentiment tool-call record',
						displayOptions: { show: { includeToolCalls: [true] } },
					},
					{
						displayName: 'When No Clear Match',
						name: 'fallback',
						type: 'options',
						default: 'discard',
						description: 'What to do when Needle returns no sentiment or falls below the confidence threshold',
						options: [
							{ name: 'Discard Item', value: 'discard' },
							{ name: "Output on Extra, 'Other' Branch", value: 'other' },
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const options = this.getNodeParameter('options', 0, {}) as SentimentOptions;
		const categories = parseSentimentCategories(options.categories ?? DEFAULT_CATEGORIES);
		if (categories.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No sentiment categories provided');
		}

		const fallback = options.fallback ?? 'discard';
		const returnData: INodeExecutionData[][] = Array.from(
			{ length: categories.length + (fallback === 'other' ? 1 : 0) },
			() => [],
		);
		const sentimentTool = buildSentimentTool(
			categories,
			options.systemPromptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
		);
		const runtime = NeedleRuntime.getInstance();
		const modelSource = this.getNodeParameter('modelSource', 0) as NeedleModelOptions['source'];
		const model = await runtime.loadModel({
			source: modelSource,
			path: modelSource === 'custom' ? (this.getNodeParameter('modelPath', 0) as string) : undefined,
		});
		const batchSize = Math.max(1, options.batching?.batchSize ?? 5);
		const delayBetweenBatches = Math.max(0, options.batching?.delayBetweenBatches ?? 0);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputText = this.getNodeParameter('inputText', itemIndex) as string;
				if (!inputText) {
					throw new NodeOperationError(this.getNode(), `Text to analyze for item ${itemIndex} is not defined`, {
						itemIndex,
					});
				}
				const session = await runtime.createSession(model, {
					tools: [sentimentTool],
					maxNewTokens: options.maxNewTokens ?? 256,
				});
				const response = await session.complete(formatSentimentInput(inputText));
				const sentimentIndex = selectSentimentIndex(
					response,
					categories,
					options.minimumConfidence ?? 0.3,
				);

				let strengthResponse: NeedleResponse | undefined;
				let strength: number | undefined;
				if (sentimentIndex >= 0 && options.includeDetailedResults) {
					const strengthTool = buildSentimentStrengthTool();
					const strengthSession = await runtime.createSession(model, {
						tools: [strengthTool],
						maxNewTokens: options.maxNewTokens ?? 256,
					});
					strengthResponse = await strengthSession.complete(
						formatStrengthInput(inputText, categories[sentimentIndex]),
					);
					strength = extractSentimentStrength(strengthResponse);
				}

				const routedItem = createSentimentItem(
					items[itemIndex],
					itemIndex,
					inputText,
					categories,
					sentimentIndex,
					response,
					strength,
					strengthResponse,
					sentimentTool,
					options,
				);
				if (sentimentIndex >= 0) returnData[sentimentIndex].push(routedItem);
				else if (fallback === 'other') returnData[returnData.length - 1].push(routedItem);
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

			if ((itemIndex + 1) % batchSize === 0 && itemIndex + 1 < items.length && delayBetweenBatches > 0) {
				await sleep(delayBetweenBatches);
			}
		}

		return returnData;
	}
}

export function parseSentimentCategories(value: string): string[] {
	return value
		.split(',')
		.map((category) => category.trim())
		.filter(Boolean);
}

export function buildSentimentTool(
	categories: string[],
	promptTemplate = DEFAULT_PROMPT_TEMPLATE,
): NeedleToolDefinition {
	const categoryText = categories.join(', ');
	const renderedTemplate = promptTemplate
		.split('{{categories}}').join(categoryText)
		.split('{categories}').join(categoryText);
	return {
		name: 'analyze_sentiment',
		description: `${renderedTemplate}\n\nSentiment categories:\n${categories.map((category) => `- ${category}`).join('\n')}`,
		parameters: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'The supplied text to analyze' },
				sentiment: {
					type: 'string',
					description: 'The sentiment category that applies to the text',
					enum: categories,
				},
			},
			required: ['text', 'sentiment'],
			additionalProperties: false,
		},
	};
}

export function buildSentimentStrengthTool(): NeedleToolDefinition {
	return {
		name: 'score_sentiment',
		description: 'Scores the strength of an identified sentiment from 0 to 1.',
		parameters: {
			type: 'object',
			properties: {
				strength: {
					type: 'number',
					description: 'Strength of the identified sentiment',
					minimum: 0,
					maximum: 1,
				},
			},
			required: ['strength'],
			additionalProperties: false,
		},
	};
}

export function formatSentimentInput(inputText: string): string {
	return `The text to analyze is: ${JSON.stringify(inputText)}`;
}

export function formatStrengthInput(inputText: string, sentiment: string): string {
	const sentimentFact = sentiment.replace(/[\r\n]+/g, ' ').trim();
	return `The sentiment is ${sentimentFact}. The text is ${JSON.stringify(inputText)}. Determine its strength.`;
}

export function selectSentimentIndex(
	response: NeedleResponse,
	categories: string[],
	minimumConfidence: number,
): number {
	if (!response.success || response.confidence < minimumConfidence) return -1;
	for (const call of response.functionCalls) {
		if (call.name !== 'analyze_sentiment' || typeof call.arguments.sentiment !== 'string') continue;
		const selected = call.arguments.sentiment.trim().toLowerCase();
		const index = categories.findIndex((category) => category.toLowerCase() === selected);
		if (index >= 0) return index;
	}
	return -1;
}

export function extractSentimentStrength(response: NeedleResponse): number | undefined {
	const call = response.functionCalls.find(({ name }) => name === 'score_sentiment');
	const strength = call?.arguments.strength;
	return typeof strength === 'number' && Number.isFinite(strength)
		? Math.max(0, Math.min(1, strength))
		: undefined;
}

function createSentimentItem(
	item: INodeExecutionData,
	itemIndex: number,
	inputText: string,
	categories: string[],
	sentimentIndex: number,
	response: NeedleResponse,
	strength: number | undefined,
	strengthResponse: NeedleResponse | undefined,
	sentimentTool: NeedleToolDefinition,
	options: SentimentOptions,
): INodeExecutionData {
	const json: IDataObject = { ...item.json };
	if (sentimentIndex >= 0) {
		const sentimentAnalysis: IDataObject = { category: categories[sentimentIndex] };
		if (options.includeDetailedResults) {
			sentimentAnalysis.strength = strength ?? 0;
			sentimentAnalysis.confidence = response.confidence;
		}
		json.sentimentAnalysis = sentimentAnalysis;
	}
	if (options.includeToolCalls) {
		const field = options.toolCallsOutputField?.trim() || 'needleSentiment';
		json[field] = createSentimentRecord(
			inputText,
			sentimentTool,
			response,
			options.minimumConfidence ?? 0.3,
			options.includeMetrics ?? false,
			strengthResponse,
		);
	}
	return { json, binary: item.binary, pairedItem: { item: itemIndex } };
}

export function createSentimentRecord(
	inputText: string,
	sentimentTool: NeedleToolDefinition,
	response: NeedleResponse,
	minimumConfidence: number,
	includeMetrics: boolean,
	strengthResponse?: NeedleResponse,
): JsonObject {
	const tools = strengthResponse
		? [sentimentTool, buildSentimentStrengthTool()]
		: [sentimentTool];
	const toolCalls = [
		...response.functionCalls,
		...(strengthResponse?.functionCalls ?? []),
	];
	const record: JsonObject = {
		input: inputText,
		tools: tools as unknown as JsonObject[],
		toolCalls: toolCalls as unknown as JsonObject[],
		confidence: response.confidence,
		belowThreshold: response.confidence < minimumConfidence,
	};
	if (includeMetrics) {
		const metrics: Record<string, NeedleMetrics> = { sentiment: response.metrics };
		if (strengthResponse) metrics.strength = strengthResponse.metrics;
		record.metrics = metrics as unknown as JsonObject;
	}
	return record;
}
