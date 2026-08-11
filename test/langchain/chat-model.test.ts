import assert from 'node:assert/strict';
import test from 'node:test';

import type { Message } from '@n8n/ai-node-sdk';

import { NeedleChatModel } from '../../langchain/NeedleChatModel';
import type { NeedleRuntime } from '../../runtime/NeedleRuntime';
import type { NeedleResponse } from '../../runtime/types';

test('returns a visible message when Needle refuses every connected tool', async () => {
	const response: NeedleResponse = {
		type: 'call',
		success: true,
		error: null,
		errorCode: null,
		functionCalls: [],
		confidence: 0.95,
		metrics: {
			durationMs: 1,
			wasmInitializationMs: 1,
			modelLoadMs: 1,
			toolCount: 1,
		},
		raw: { type: 'call', function_calls: [] },
	};
	const runtime = {
		loadModel: async () => ({ key: 'test' }),
		createSession: async () => ({ replay: async () => response }),
	} as unknown as NeedleRuntime;
	const model = new NeedleChatModel({
		model: { source: 'builtIn' },
		minimumConfidence: 0.8,
		lowConfidenceBehavior: 'markLowConfidence',
		runtime,
	});
	const messages: Message[] = [
		{ role: 'user', content: [{ type: 'text', text: 'Do something unsupported' }] },
	];

	const result = await model.generate(messages);

	assert.equal(result.finishReason, 'stop');
	assert.deepEqual(result.message.content, [{
		type: 'text',
		text: 'Needle could not match the request to any connected tool.',
	}]);
});
