/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- This is intentionally a standalone workflow node. */
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { NeedleRuntime } from '../../runtime/NeedleRuntime';
import type { NeedleResponse, NeedleToolDefinition } from '../../runtime/types';

const OUTPUT_CATEGORIES = ['Positive', 'Neutral', 'Negative'] as const;

export const SENTIMENT_TOOL: NeedleToolDefinition = {
	name: 'classify_sentiment',
	description: 'Classify the sentiment of a message.',
	parameters: {
		type: 'object',
		properties: {
			sentiment: {
				type: 'string',
				enum: ['positive', 'negative', 'neutral', 'mixed'],
			},
		},
		required: ['sentiment'],
	},
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
		subtitle: 'Built-In Needle 2',
		inputs: [NodeConnectionTypes.Main],
		outputs: OUTPUT_CATEGORIES.map((displayName) => ({
			type: NodeConnectionTypes.Main,
			displayName,
		})),
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
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				options: [
					{
						displayName: 'Include Detailed Results',
						name: 'includeDetailedResults',
						type: 'boolean',
						default: false,
						description: 'Whether to include sentiment strength and confidence scores in the output',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[][] = OUTPUT_CATEGORIES.map(() => []);
		const runtime = NeedleRuntime.getInstance();
		const model = await runtime.loadModel({ source: 'builtIn' });

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputText = this.getNodeParameter('inputText', itemIndex) as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as {
					includeDetailedResults?: boolean;
				};
				if (!inputText) {
					throw new NodeOperationError(
						this.getNode(),
						`Text to analyze for item ${itemIndex} is not defined`,
						{ itemIndex },
					);
				}

				const session = await runtime.createSession(model, { tools: [SENTIMENT_TOOL] });
				const response = await session.complete(formatSentimentInput(inputText));
				const sentimentIndex = selectSentimentIndex(response);
				if (sentimentIndex < 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Needle did not return a valid sentiment classification',
						{ itemIndex },
					);
				}

				const sentimentAnalysis: IDataObject = {
					category: OUTPUT_CATEGORIES[sentimentIndex],
				};
				if (options.includeDetailedResults) {
					sentimentAnalysis.strength = response.confidence;
					sentimentAnalysis.confidence = response.confidence;
				}

				returnData[sentimentIndex].push({
					json: {
						...items[itemIndex].json,
						sentimentAnalysis,
					},
					binary: items[itemIndex].binary,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				const executionError =
					error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
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

export function formatSentimentInput(inputText: string): string {
	return `classify the sentiment of this message: ${inputText}`;
}

export function selectSentimentIndex(response: NeedleResponse): number {
	if (!response.success) return -1;

	for (const call of response.functionCalls) {
		if (call.name !== SENTIMENT_TOOL.name || typeof call.arguments.sentiment !== 'string') continue;
		switch (call.arguments.sentiment.trim().toLowerCase()) {
			case 'positive':
				return 0;
			case 'neutral':
			case 'mixed':
				return 1;
			case 'negative':
				return 2;
		}
	}
	return -1;
}
