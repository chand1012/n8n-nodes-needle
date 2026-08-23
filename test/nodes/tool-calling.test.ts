import assert from 'node:assert/strict';
import test from 'node:test';

import { DynamicTool } from '@langchain/core/tools';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import type { ISupplyDataFunctions } from 'n8n-workflow';

import {
	NeedleToolCallingTool,
	normalizeNeedleToolInput,
} from '../../nodes/NeedleToolCallingTool/NeedleToolCallingTool.node.ts';
import {
	formatChainOutput,
	getChainOptions,
	getChainOutputOptions,
	modelProperties,
} from '../../nodes/shared/tool-calling.ts';
import type { NeedleChainExecution, NeedleResponse } from '../../runtime/types';

const metrics = {
	durationMs: 2,
	wasmInitializationMs: 1,
	modelLoadMs: 1,
	toolCount: 1,
};

const finalResponse: NeedleResponse = {
	type: 'respond',
	success: true,
	error: null,
	errorCode: null,
	functionCalls: [],
	reasoning: 'done',
	confidence: 0.95,
	metrics,
	raw: {},
};

const execution: NeedleChainExecution = {
	query: 'Do the work',
	definedTools: [{ name: 'work', parameters: { type: 'object' } }],
	results: [{ ok: true }],
	rounds: [{
		step: 1,
		input: 'Do the work',
		response: finalResponse,
		executions: [],
	}],
	finalResponse,
	stopReason: 'completed',
};

test('formats compact output by default and includes copyable tool definitions', () => {
	const output = formatChainOutput(execution, false, false);
	assert.deepEqual(output.definedTools, execution.definedTools);
	assert.deepEqual(output.results, execution.results);
	assert.equal(output.stopReason, 'completed');
	assert.ok(!('rounds' in output));
	assert.ok(!('metrics' in output));
});

test('adds rounds and metrics only in detailed metric output', () => {
	const output = formatChainOutput(execution, true, true);
	assert.equal(output.query, 'Do the work');
	assert.ok(Array.isArray(output.rounds));
	assert.deepEqual(output.metrics, metrics);
	assert.deepEqual((output.finalResponse as Record<string, unknown>).metrics, metrics);
});

test('Agent tool exposes prompt as its only invocation argument', async () => {
	const connectedTool = new DynamicTool({
		name: 'work',
		description: 'Do work',
		func: async (input) => input,
	});
	const parameters: Record<string, unknown> = {
		toolName: 'needle_tool_calling',
		toolDescription: 'Delegate tool work',
		prompt: `={{ $fromAI('prompt', 'Request to complete with the connected tools', 'string') }}`,
		modelSource: 'builtIn',
		system: '',
		minimumConfidence: 0.8,
		maxSteps: 8,
		maxNewTokens: 256,
		includeMetrics: false,
		detailedOutput: false,
	};
	const context = {
		getInputConnectionData: async () => [connectedTool],
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getNode: () => ({
			id: 'needle-tool',
			name: 'Needle Tool Calling Tool',
			type: 'n8n-nodes-needle.needleToolCallingTool',
			typeVersion: 1,
			position: [0, 0],
			parameters,
		}),
	} as unknown as ISupplyDataFunctions;

	const supplied = await new NeedleToolCallingTool().supplyData!.call(context, 0);
	const schema = toJsonSchema((supplied.response as { schema: Parameters<typeof toJsonSchema>[0] }).schema);
	assert.deepEqual(Object.keys(schema.properties ?? {}), ['prompt']);
	assert.deepEqual(schema.required, ['prompt']);
});

test('Agent tool supports n8n engine execution as well as supplyData', () => {
	const node = new NeedleToolCallingTool();
	assert.equal(typeof node.supplyData, 'function');
	assert.equal(typeof node.execute, 'function');
});

test('engine execution strips bookkeeping fields before structured-tool validation', () => {
	const node = { name: 'Needle Tool Calling Tool', type: 'test', typeVersion: 1, position: [0, 0] };
	assert.deepEqual(
		normalizeNeedleToolInput(
			{ prompt: 'Find AAPL', toolCallId: 'call-1', action: 'invoke' },
			node,
		),
		{ prompt: 'Find AAPL' },
	);
});

test('hides Max Steps in optional settings and defaults it to one', () => {
	assert.ok(!modelProperties.some(({ name }) => name === 'maxSteps'));
	const optionsProperty = modelProperties.find(({ name }) => name === 'options');
	assert.equal(optionsProperty?.type, 'collection');
	assert.ok(optionsProperty?.options?.some(({ name }) => name === 'maxSteps'));

	const parameters: Record<string, unknown> = { modelSource: 'builtIn', options: {} };
	const context = {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
	};
	assert.equal(getChainOptions(context, 0).maxSteps, 1);
});

test('groups token and output controls under optional settings', () => {
	const topLevelNames = new Set(modelProperties.map(({ name }) => name));
	assert.ok(!topLevelNames.has('maxNewTokens'));
	assert.ok(!topLevelNames.has('includeMetrics'));
	assert.ok(!topLevelNames.has('detailedOutput'));

	const optionsProperty = modelProperties.find(({ name }) => name === 'options');
	const optionNames = new Set(optionsProperty?.options?.map(({ name }) => name));
	assert.ok(optionNames.has('maxNewTokens'));
	assert.ok(optionNames.has('includeMetrics'));
	assert.ok(optionNames.has('detailedOutput'));
});

test('reads optional and legacy Max Steps values', () => {
	const parameterContext = (parameters: Record<string, unknown>) => ({
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
	});

	assert.equal(
		getChainOptions(parameterContext({ modelSource: 'builtIn', options: { maxSteps: 3 } }), 0).maxSteps,
		3,
	);
	assert.equal(
		getChainOptions(parameterContext({ modelSource: 'builtIn', maxSteps: 4 }), 0).maxSteps,
		4,
	);
});

test('reads optional token and output controls with legacy compatibility', () => {
	const parameterContext = (parameters: Record<string, unknown>) => ({
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
	});
	const optional = parameterContext({
		modelSource: 'builtIn',
		options: { maxNewTokens: 96, includeMetrics: true, detailedOutput: true },
	});
	assert.equal(getChainOptions(optional, 0).maxNewTokens, 96);
	assert.deepEqual(getChainOutputOptions(optional, 0), {
		includeMetrics: true,
		detailedOutput: true,
	});

	const legacy = parameterContext({
		modelSource: 'builtIn',
		maxNewTokens: 128,
		includeMetrics: true,
		detailedOutput: true,
	});
	assert.equal(getChainOptions(legacy, 0).maxNewTokens, 128);
	assert.deepEqual(getChainOutputOptions(legacy, 0), {
		includeMetrics: true,
		detailedOutput: true,
	});
});

test('does not request removed legacy parameters without a concrete fallback', () => {
	const parameters: Record<string, unknown> = {
		modelSource: 'builtIn',
		system: '',
		minimumConfidence: 0.8,
		options: {},
	};
	const strictContext = {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) => {
			const value = parameters[name] ?? fallback;
			if (value === undefined) throw new Error(`Could not get parameter "${name}"`);
			return value;
		},
	};

	assert.deepEqual(getChainOutputOptions(strictContext, 0), {
		includeMetrics: false,
		detailedOutput: false,
	});
	assert.equal(getChainOptions(strictContext, 0).maxSteps, 1);
	assert.equal(getChainOptions(strictContext, 0).maxNewTokens, 256);
});
