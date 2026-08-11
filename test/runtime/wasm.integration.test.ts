import assert from 'node:assert/strict';
import test from 'node:test';

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
