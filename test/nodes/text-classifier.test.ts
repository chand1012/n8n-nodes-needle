import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildCategoryTools,
	createClassificationRecord,
	formatClassifierInput,
	NeedleTextClassifier,
	selectCategoryIndexes,
} from '../../nodes/NeedleTextClassifier/NeedleTextClassifier.node.ts';
import type { NeedleFunctionCall, NeedleResponse } from '../../runtime/types.ts';

function response(functionCalls: NeedleFunctionCall[], confidence = 1): NeedleResponse {
	return {
		type: functionCalls.length > 0 ? 'call' : 'respond',
		success: true,
		error: null,
		errorCode: null,
		functionCalls,
		confidence,
		metrics: { durationMs: 0, wasmInitializationMs: 0, modelLoadMs: 0, toolCount: 0 },
		raw: {},
	};
}

test('generates one classify function with described literal category options', () => {
	const tools = buildCategoryTools([
		{ category: 'Billing & refunds', description: 'Payment and refund requests' },
		{ category: 'Technical support' },
	]);

	assert.deepEqual(tools, [
		{
			name: 'classify',
			description:
				'Classifies text into a category.\n\nCategories:\n- Billing & refunds: Payment and refund requests\n- Technical support: No description provided',
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
						enum: ['Billing & refunds', 'Technical support'],
					},
				},
				required: ['text', 'category'],
				additionalProperties: false,
			},
		},
	]);
});

test('quotes classifier input so Needle treats it as supplied data', () => {
	assert.equal(
		formatClassifierInput('A quote: "hello"\nand a second line'),
		'The text to classify is: "A quote: \\"hello\\"\\nand a second line"',
	);
});

test('routes only the first valid function call in single-class mode', () => {
	const categories = [{ category: 'First' }, { category: 'Second' }];
	const result = selectCategoryIndexes(
		response([
			{ name: 'unknown', arguments: {} },
			{ name: 'classify', arguments: { category: 'Second' } },
			{ name: 'classify', arguments: { category: 'First' } },
		]),
		categories,
		false,
		0.8,
	);

	assert.deepEqual(result, [1]);
});

test('routes a copy to each unique selected branch in multi-class mode', () => {
	const categories = [{ category: 'First' }, { category: 'Second' }];
	const result = selectCategoryIndexes(
		response([
			{ name: 'classify', arguments: { category: 'Second' } },
			{ name: 'classify', arguments: { category: 'First' } },
			{ name: 'classify', arguments: { category: 'Second' } },
		]),
		categories,
		true,
		0.8,
	);

	assert.deepEqual(result, [1, 0]);
});

test('treats a low-confidence response as no clear match', () => {
	const categories = [{ category: 'First' }];
	assert.deepEqual(
		selectCategoryIndexes(
			response([{ name: 'classify', arguments: { category: 'First' } }], 0.79),
			categories,
			false,
			0.8,
		),
		[],
	);
});

test('only includes metrics inside the tool-call output when requested', () => {
	const result = response([{ name: 'classify', arguments: { category: 'First' } }], 0.9);
	const tools = buildCategoryTools([{ category: 'First' }]);

	assert.equal('metrics' in createClassificationRecord('text', tools, result, 0.3, false), false);
	assert.deepEqual(
		createClassificationRecord('text', tools, result, 0.3, true).metrics,
		result.metrics,
	);
});

test('is a regular workflow node with category-driven outputs and no model connection', () => {
	const description = new NeedleTextClassifier().description;
	const propertyNames = description.properties.map(({ name }) => name);
	const options = description.properties.find(({ name }) => name === 'options');
	const minimumConfidence = options?.type === 'collection'
		? options.options.find(({ name }) => name === 'minimumConfidence')
		: undefined;
	const includeMetrics = options?.type === 'collection'
		? options.options.find(({ name }) => name === 'includeMetrics')
		: undefined;

	assert.deepEqual(description.inputs, ['main']);
	assert.equal(typeof description.outputs, 'string');
	assert.equal(minimumConfidence?.default, 0.3);
	assert.deepEqual(includeMetrics?.displayOptions, { show: { includeToolCalls: [true] } });
	assert.ok(propertyNames.includes('inputText'));
	assert.ok(propertyNames.includes('categories'));
	assert.ok(propertyNames.includes('modelSource'));
	assert.ok(propertyNames.includes('options'));
});
