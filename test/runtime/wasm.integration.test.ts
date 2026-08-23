import assert from 'node:assert/strict';
import test from 'node:test';

import {
	formatSentimentInput,
	SENTIMENT_TOOL,
} from '../../nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.ts';
import { NeedleRuntime } from '../../runtime/NeedleRuntime';

test('runs bundled Needle 2 through WebAssembly', { timeout: 120_000 }, async () => {
	const runtime = new NeedleRuntime();
	const model = await runtime.loadModel({ source: 'builtIn' });
	const session = await runtime.createSession(model, {
		tools: [{
			name: 'get_weather',
			description: 'Get the current weather for a city',
			parameters: {
				type: 'object',
				properties: { city: { type: 'string', description: 'City name' } },
				required: ['city'],
			},
		}],
	});
	const result = await session.complete('What is the weather in Lagos?');
	assert.equal(result.success, true);
	assert.equal(result.type, 'call');
	assert.deepEqual(result.functionCalls, [{ name: 'get_weather', arguments: { city: 'Lagos' } }]);
	assert.ok(result.confidence > 0.8);
	assert.equal(typeof result.confidence, 'number');
	assert.equal(typeof result.metrics.prefillTokensPerSecond, 'number');
	assert.ok(Array.isArray(result.raw.function_calls));
});

test('keeps one WASM session active across chained completions', { timeout: 120_000 }, async () => {
	const runtime = new NeedleRuntime();
	const model = await runtime.loadModel({ source: 'builtIn' });
	const session = await runtime.createSession(model, {
		tools: [{
			name: 'get_weather',
			description: 'Get the current weather for a city',
			parameters: {
				type: 'object',
				properties: { city: { type: 'string' } },
				required: ['city'],
			},
		}],
	});

	const responses = await session.run(async (complete) => [
		complete('What is the weather in Lagos?'),
		complete('[{"city":"Lagos","temp_c":27}]'),
	]);

	assert.equal(responses[0].type, 'call');
	assert.deepEqual(responses[0].functionCalls[0], {
		name: 'get_weather',
		arguments: { city: 'Lagos' },
	});
	assert.equal(responses[1].functionCalls.length, 0);
});

test('runs the Needle website sentiment method through bundled WebAssembly', { timeout: 120_000 }, async () => {
	const runtime = new NeedleRuntime();
	const model = await runtime.loadModel({ source: 'builtIn' });
	const examples = [
		['I absolutely love this product!', 'positive'],
		['This is the worst purchase I have ever made.', 'negative'],
		['The sentiment is mixed.', 'mixed'],
	] as const;

	for (const [input, expected] of examples) {
		const session = await runtime.createSession(model, { tools: [SENTIMENT_TOOL] });
		const result = await session.complete(formatSentimentInput(input));

		assert.equal(result.success, true);
		assert.deepEqual(result.functionCalls, [
			{ name: 'classify_sentiment', arguments: { sentiment: expected } },
		]);
	}
});
