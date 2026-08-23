import assert from 'node:assert/strict';
import test from 'node:test';

import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	formatSentimentInput,
	NeedleSentimentAnalysis,
	selectSentimentIndex,
	SENTIMENT_TOOL,
} from '../../nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.ts';
import { NeedleRuntime } from '../../runtime/NeedleRuntime.ts';
import type { NeedleFunctionCall, NeedleResponse } from '../../runtime/types.ts';

function response(
	functionCalls: NeedleFunctionCall[],
	success = true,
	confidence = 1,
): NeedleResponse {
	return {
		type: functionCalls.length > 0 ? 'call' : 'respond',
		success,
		error: success ? null : 'inference failed',
		errorCode: null,
		functionCalls,
		confidence,
		metrics: { durationMs: 2, wasmInitializationMs: 0, modelLoadMs: 0, toolCount: 1 },
		raw: {},
	};
}

function sentimentResponse(sentiment: string, confidence = 1): NeedleResponse {
	return response([{ name: 'classify_sentiment', arguments: { sentiment } }], true, confidence);
}

test('matches the Needle website sentiment tool exactly', () => {
	assert.deepEqual(SENTIMENT_TOOL, {
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
	});
});

test('uses the Needle website sentiment query structure exactly', () => {
	assert.equal(
		formatSentimentInput('this is great'),
		'classify the sentiment of this message: this is great',
	);
});

test('routes positive, neutral, negative, and mixed sentiments', () => {
	assert.equal(selectSentimentIndex(sentimentResponse('positive')), 0);
	assert.equal(selectSentimentIndex(sentimentResponse('neutral')), 1);
	assert.equal(selectSentimentIndex(sentimentResponse('negative')), 2);
	assert.equal(selectSentimentIndex(sentimentResponse('mixed')), 1);
	assert.equal(selectSentimentIndex(sentimentResponse(' MiXeD ')), 1);
});

test('rejects unsuccessful, empty, unrelated, and invalid calls', () => {
	assert.equal(selectSentimentIndex(response([], false)), -1);
	assert.equal(selectSentimentIndex(response([])), -1);
	assert.equal(selectSentimentIndex(response([{ name: 'other', arguments: { sentiment: 'positive' } }])), -1);
	assert.equal(selectSentimentIndex(sentimentResponse('uncertain')), -1);
});

test('uses the first valid sentiment call', () => {
	assert.equal(
		selectSentimentIndex(
			response([
				{ name: 'classify_sentiment', arguments: { sentiment: 'uncertain' } },
				{ name: 'other', arguments: { sentiment: 'negative' } },
				{ name: 'classify_sentiment', arguments: { sentiment: 'negative' } },
			]),
		),
		2,
	);
});

test('exposes detailed results as the only option and uses fixed outputs', () => {
	const description = new NeedleSentimentAnalysis().description;
	const options = description.properties.find(({ name }) => name === 'options');

	assert.deepEqual(description.inputs, ['main']);
	assert.deepEqual(description.properties.map(({ name }) => name), [
		'inputText',
		'detailedResultsNotice',
		'options',
	]);
	assert.equal(options?.type, 'collection');
	if (options?.type === 'collection') {
		assert.deepEqual(options.options.map(({ name }) => name), ['includeDetailedResults']);
		assert.equal(options.options[0].default, false);
	}
	assert.deepEqual(
		description.outputs,
		[
			{ type: 'main', displayName: 'Positive' },
			{ type: 'main', displayName: 'Neutral' },
			{ type: 'main', displayName: 'Negative' },
		],
	);
});

test('copies Needle confidence to detailed confidence and strength', async (t) => {
	const originalGetInstance = NeedleRuntime.getInstance;
	const fakeRuntime = {
		async loadModel() {
			return {};
		},
		async createSession() {
			return { async complete() { return sentimentResponse('positive', 0.73); } };
		},
	};
	NeedleRuntime.getInstance = () => fakeRuntime as unknown as NeedleRuntime;
	t.after(() => {
		NeedleRuntime.getInstance = originalGetInstance;
	});

	const result = await new NeedleSentimentAnalysis().execute.call(
		createExecuteFunctions([{ json: { id: 8 } }], ['excellent'], false, true),
	);

	assert.deepEqual(result[0][0].json.sentimentAnalysis, {
		category: 'Positive',
		strength: 0.73,
		confidence: 0.73,
	});
});

test('executes with the built-in model and preserves item data while normalizing mixed', async (t) => {
	const originalGetInstance = NeedleRuntime.getInstance;
	const inputs: string[] = [];
	let loadedSource: string | undefined;
	let configuredTools: unknown;
	const fakeRuntime = {
		async loadModel({ source }: { source: string }) {
			loadedSource = source;
			return {};
		},
		async createSession(_model: unknown, options: { tools: unknown }) {
			configuredTools = options.tools;
			return {
				async complete(input: string) {
					inputs.push(input);
					return sentimentResponse('mixed');
				},
			};
		},
	};
	NeedleRuntime.getInstance = () => fakeRuntime as unknown as NeedleRuntime;
	t.after(() => {
		NeedleRuntime.getInstance = originalGetInstance;
	});

	const binary = { attachment: { data: 'aGVsbG8=', mimeType: 'text/plain' } };
	const item = { json: { id: 7, text: 'good and bad' }, binary } as INodeExecutionData;
	const executeFunctions = createExecuteFunctions([item], ['good and bad']);

	const result = await new NeedleSentimentAnalysis().execute.call(executeFunctions);

	assert.equal(loadedSource, 'builtIn');
	assert.deepEqual(configuredTools, [SENTIMENT_TOOL]);
	assert.deepEqual(inputs, ['classify the sentiment of this message: good and bad']);
	assert.equal(result[0].length, 0);
	assert.equal(result[2].length, 0);
	assert.deepEqual(result[1][0], {
		json: {
			id: 7,
			text: 'good and bad',
			sentimentAnalysis: { category: 'Neutral' },
		},
		binary,
		pairedItem: { item: 0 },
	});
});

test('throws for missing text and emits an error item when continuing on failure', async (t) => {
	const originalGetInstance = NeedleRuntime.getInstance;
	const fakeRuntime = {
		async loadModel() {
			return {};
		},
		async createSession() {
			return { async complete() { return response([]); } };
		},
	};
	NeedleRuntime.getInstance = () => fakeRuntime as unknown as NeedleRuntime;
	t.after(() => {
		NeedleRuntime.getInstance = originalGetInstance;
	});

	const node = new NeedleSentimentAnalysis();
	await assert.rejects(
		node.execute.call(createExecuteFunctions([{ json: { id: 1 } }], [''])),
		/Text to analyze for item 0 is not defined/,
	);

	const continued = await node.execute.call(
		createExecuteFunctions([{ json: { id: 2 } }], ['unclear'], true),
	);
	assert.equal(continued[1].length, 0);
	assert.equal(continued[2].length, 0);
	assert.deepEqual(continued[0][0].pairedItem, { item: 0 });
	assert.equal(continued[0][0].json.id, 2);
	assert.match(String(continued[0][0].json.error), /valid sentiment classification/);
});

function createExecuteFunctions(
	items: INodeExecutionData[],
	inputTexts: string[],
	continueOnFail = false,
	includeDetailedResults = false,
): IExecuteFunctions {
	return {
		getInputData: () => items,
		getNodeParameter: (name: string, itemIndex: number) =>
			name === 'options' ? { includeDetailedResults } : inputTexts[itemIndex],
		getNode: () => ({
			id: 'needle-sentiment',
			name: 'Needle Sentiment Analysis',
			type: 'n8n-nodes-needle.needleSentimentAnalysis',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}
