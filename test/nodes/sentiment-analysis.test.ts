import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildSentimentStrengthTool,
	buildSentimentTool,
	createSentimentRecord,
	extractSentimentStrength,
	formatSentimentInput,
	formatStrengthInput,
	NeedleSentimentAnalysis,
	parseSentimentCategories,
	selectSentimentIndex,
} from '../../nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.ts';
import type { NeedleFunctionCall, NeedleResponse } from '../../runtime/types.ts';

function response(functionCalls: NeedleFunctionCall[], confidence = 1): NeedleResponse {
	return {
		type: functionCalls.length > 0 ? 'call' : 'respond',
		success: true,
		error: null,
		errorCode: null,
		functionCalls,
		confidence,
		metrics: { durationMs: 2, wasmInitializationMs: 0, modelLoadMs: 0, toolCount: 1 },
		raw: {},
	};
}

test('parses the same comma-separated sentiment categories as the n8n node', () => {
	assert.deepEqual(parseSentimentCategories(' Positive, Neutral, , Negative '), [
		'Positive',
		'Neutral',
		'Negative',
	]);
});

test('builds a grammar-constrained sentiment tool from the prompt template', () => {
	const tool = buildSentimentTool(
		['Positive', 'Negative'],
		'Choose a sentiment from {categories}.',
	);

	assert.equal(tool.name, 'analyze_sentiment');
	assert.match(tool.description ?? '', /Choose a sentiment from Positive, Negative\./);
	assert.deepEqual(
		(tool.parameters.properties as Record<string, Record<string, unknown>>).sentiment.enum,
		['Positive', 'Negative'],
	);
	assert.deepEqual(tool.parameters.required, ['text', 'sentiment']);
});

test('routes sentiment case-insensitively and respects Needle confidence', () => {
	const categories = ['Positive', 'Neutral', 'Negative'];
	assert.equal(
		selectSentimentIndex(
			response([{ name: 'analyze_sentiment', arguments: { sentiment: 'negative' } }], 0.8),
			categories,
			0.3,
		),
		2,
	);
	assert.equal(
		selectSentimentIndex(
			response([{ name: 'analyze_sentiment', arguments: { sentiment: 'Negative' } }], 0.2),
			categories,
			0.3,
		),
		-1,
	);
});

test('constrains detailed sentiment strength and clamps returned values', () => {
	const tool = buildSentimentStrengthTool();
	const strength = (tool.parameters.properties as Record<string, Record<string, unknown>>).strength;

	assert.equal(strength.minimum, 0);
	assert.equal(strength.maximum, 1);
	assert.equal(
		extractSentimentStrength(
			response([{ name: 'score_sentiment', arguments: { strength: 1.2 } }]),
		),
		1,
	);
});

test('quotes sentiment input and only exposes metrics through tool-call output', () => {
	assert.equal(
		formatSentimentInput('This is "great"'),
		'The text to analyze is: "This is \\"great\\""',
	);
	assert.equal(
		formatStrengthInput('This is "great"', 'Very\nPositive'),
		'The sentiment is Very Positive. The text is "This is \\"great\\"". Determine its strength.',
	);
	const tool = buildSentimentTool(['Positive']);
	const result = response([
		{ name: 'analyze_sentiment', arguments: { text: 'great', sentiment: 'Positive' } },
	], 0.9);

	assert.equal('metrics' in createSentimentRecord('great', tool, result, 0.3, false), false);
	assert.deepEqual(
		createSentimentRecord('great', tool, result, 0.3, true).metrics,
		{ sentiment: result.metrics },
	);
});

test('mirrors sentiment options, adds Needle controls, and omits auto-fixing', () => {
	const description = new NeedleSentimentAnalysis().description;
	const options = description.properties.find(({ name }) => name === 'options');
	assert.equal(options?.type, 'collection');
	if (options?.type !== 'collection') return;

	const propertyNames = options.options.map(({ name }) => name);
	const minimumConfidence = options.options.find(({ name }) => name === 'minimumConfidence');
	const includeMetrics = options.options.find(({ name }) => name === 'includeMetrics');

	assert.deepEqual(description.inputs, ['main']);
	assert.ok(propertyNames.includes('batching'));
	assert.ok(propertyNames.includes('categories'));
	assert.ok(propertyNames.includes('includeDetailedResults'));
	assert.ok(propertyNames.includes('systemPromptTemplate'));
	assert.ok(propertyNames.includes('modelSource') === false);
	assert.ok(!propertyNames.includes('enableAutoFixing'));
	assert.equal(minimumConfidence?.default, 0.3);
	assert.deepEqual(includeMetrics?.displayOptions, { show: { includeToolCalls: [true] } });
});
