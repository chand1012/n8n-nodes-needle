import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConnectedNeedleTool } from '../../langchain/connected-tool-adapter';
import type { NeedleRuntime } from '../../runtime/NeedleRuntime';
import { NeedleToolOrchestrator } from '../../runtime/NeedleToolOrchestrator';
import type { NeedleResponse, NeedleSerializableValue } from '../../runtime/types';

const metrics = {
	durationMs: 1,
	wasmInitializationMs: 1,
	modelLoadMs: 1,
	toolCount: 2,
};

function response(
	functionCalls: NeedleResponse['functionCalls'],
	options: { type?: string; confidence?: number } = {},
): NeedleResponse {
	return {
		type: options.type ?? (functionCalls.length ? 'call' : 'respond'),
		success: true,
		error: null,
		errorCode: null,
		functionCalls,
		reasoning: 'test reasoning',
		confidence: options.confidence ?? 0.95,
		metrics,
		raw: {},
	};
}

function runtimeFor(responses: NeedleResponse[], inputs: string[]): NeedleRuntime {
	return {
		loadModel: async () => ({ key: 'test' }),
		createSession: async () => ({
			run: async <T>(callback: (complete: (input: string) => NeedleResponse) => Promise<T>) =>
				await callback((input: string) => {
				inputs.push(input);
				const next = responses.shift();
				if (!next) throw new Error('No fake response');
				return next;
			}),
		}),
	} as unknown as NeedleRuntime;
}

function connectedTool(
	name: string,
	invocations: string[],
	result: NeedleSerializableValue,
): ConnectedNeedleTool {
	return {
		definition: {
			name,
			description: `${name} tool`,
			parameters: { type: 'object', properties: {} },
		},
		invoke: async (arguments_) => {
			invocations.push(`${name}:${JSON.stringify(arguments_)}`);
			return result;
		},
	};
}

test('executes ordered batches and feeds results into later rounds', async () => {
	const inputs: string[] = [];
	const invocations: string[] = [];
	const runtime = runtimeFor([
		response([{ name: 'create_album', arguments: { name: 'Summer' } }]),
		response([{ name: 'move_photos', arguments: { albumId: 42 } }]),
		response([], { type: 'respond' }),
	], inputs);
	const tools = [
		connectedTool('create_album', invocations, { id: 42 }),
		connectedTool('move_photos', invocations, { moved: 8 }),
	];

	const result = await new NeedleToolOrchestrator(runtime).run('organize photos', tools, {
		model: { source: 'builtIn' },
		maxSteps: 8,
	});

	assert.deepEqual(invocations, [
		'create_album:{"name":"Summer"}',
		'move_photos:{"albumId":42}',
	]);
	assert.deepEqual(inputs, ['organize photos', '[{"id":42}]', '[{"moved":8}]']);
	assert.deepEqual(result.results, [{ id: 42 }, { moved: 8 }]);
	assert.equal(result.stopReason, 'completed');
	assert.equal(result.rounds.length, 3);
});

test('executes multiple calls in one response serially', async () => {
	const invocations: string[] = [];
	const runtime = runtimeFor([
		response([
			{ name: 'first', arguments: { order: 1 } },
			{ name: 'second', arguments: { order: 2 } },
		]),
	], []);
	const tools = [
		connectedTool('first', invocations, 'one'),
		connectedTool('second', invocations, 'two'),
	];

	await new NeedleToolOrchestrator(runtime).run('run both', tools, {
		model: { source: 'builtIn' },
	});
	assert.deepEqual(invocations, ['first:{"order":1}', 'second:{"order":2}']);
});

test('defaults to the showcased one-shot behavior without a result-fed round', async () => {
	const inputs: string[] = [];
	const invocations: string[] = [];
	const firstResponse = response([{ name: 'work', arguments: { value: 1 } }]);
	const runtime = runtimeFor([firstResponse], inputs);

	const result = await new NeedleToolOrchestrator(runtime).run(
		'do the work',
		[connectedTool('work', invocations, { done: true })],
		{ model: { source: 'builtIn' } },
	);

	assert.deepEqual(inputs, ['do the work']);
	assert.deepEqual(invocations, ['work:{"value":1}']);
	assert.equal(result.rounds.length, 1);
	assert.equal(result.finalResponse, firstResponse);
	assert.equal(result.stopReason, 'completed');
});

test('stops before low-confidence calls', async () => {
	const invocations: string[] = [];
	const runtime = runtimeFor([
		response([{ name: 'dangerous', arguments: {} }], { confidence: 0.4 }),
	], []);
	const result = await new NeedleToolOrchestrator(runtime).run(
		'do it',
		[connectedTool('dangerous', invocations, true)],
		{ model: { source: 'builtIn' }, minimumConfidence: 0.8 },
	);

	assert.deepEqual(invocations, []);
	assert.equal(result.stopReason, 'lowConfidence');
	assert.equal(result.finalResponse.belowThreshold, true);
});

test('returns a pending call when an opted-in chain reaches max steps', async () => {
	const invocations: string[] = [];
	const runtime = runtimeFor([
		response([{ name: 'again', arguments: { value: 1 } }]),
		response([{ name: 'again', arguments: { value: 2 } }]),
		response([{ name: 'again', arguments: { value: 3 } }]),
	], []);
	const result = await new NeedleToolOrchestrator(runtime).run(
		'repeat',
		[connectedTool('again', invocations, true)],
		{ model: { source: 'builtIn' }, maxSteps: 2 },
	);

	assert.deepEqual(invocations, ['again:{"value":1}', 'again:{"value":2}']);
	assert.equal(result.stopReason, 'maxSteps');
	assert.equal(result.finalResponse.functionCalls[0].arguments.value, 3);
});

test('stops immediately and reports tool call context on invocation errors', async () => {
	const runtime = runtimeFor([
		response([{ name: 'explode', arguments: {} }]),
	], []);
	const tool: ConnectedNeedleTool = {
		definition: { name: 'explode', parameters: { type: 'object' } },
		invoke: async () => { throw new Error('boom'); },
	};

	await assert.rejects(
		new NeedleToolOrchestrator(runtime).run('fail', [tool], { model: { source: 'builtIn' } }),
		/step 1, call 1.*explode.*boom/i,
	);
});

test('rejects unsuccessful Needle responses before invoking tools', async () => {
	const failed = response([{ name: 'never', arguments: {} }]);
	failed.success = false;
	failed.error = 'engine rejected the turn';
	const invocations: string[] = [];
	const runtime = runtimeFor([failed], []);

	await assert.rejects(
		new NeedleToolOrchestrator(runtime).run(
			'fail',
			[connectedTool('never', invocations, true)],
			{ model: { source: 'builtIn' } },
		),
		/engine rejected the turn/i,
	);
	assert.deepEqual(invocations, []);
});
