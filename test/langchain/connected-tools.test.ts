import assert from 'node:assert/strict';
import test from 'node:test';

import { DynamicStructuredTool, DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';

import { adaptConnectedTools } from '../../langchain/connected-tool-adapter';

test('adapts structured tools and preserves schema constraints', () => {
	const tool = new DynamicStructuredTool({
		name: 'book_trip',
		description: 'Book a trip',
		schema: z.object({ mode: z.enum(['train', 'plane']), passengers: z.number().int().min(1) }),
		func: async () => 'booked',
	});

	const [adapted] = adaptConnectedTools([tool]);
	const properties = adapted.definition.parameters.properties as Record<string, Record<string, unknown>>;
	assert.equal(adapted.definition.name, 'book_trip');
	assert.deepEqual(properties.mode.enum, ['train', 'plane']);
	assert.equal(properties.passengers.minimum, 1);
});

test('wraps string tools in an object schema and invokes them with a string', async () => {
	let received: string | undefined;
	const tool = new DynamicTool({
		name: 'uppercase',
		description: 'Uppercase text',
		func: async (input) => {
			received = input;
			return input.toUpperCase();
		},
	});

	const [adapted] = adaptConnectedTools([tool]);
	assert.deepEqual(adapted.definition.parameters.required, ['input']);
	assert.equal(await adapted.invoke({ input: 'hello' }), 'HELLO');
	assert.equal(received, 'hello');
});

test('parses JSON string results so later calls receive structured data', async () => {
	const tool = new DynamicTool({
		name: 'create_record',
		description: 'Create a record',
		func: async () => JSON.stringify({ id: 42 }),
	});
	const [adapted] = adaptConnectedTools([tool]);
	assert.deepEqual(await adapted.invoke({ input: 'create' }), { id: 42 });
});

test('flattens toolkits and rejects duplicate names', () => {
	const makeTool = () => new DynamicTool({
		name: 'lookup',
		description: 'Lookup data',
		func: async (input) => input,
	});
	const toolkit = { getTools: () => [makeTool()] };

	assert.equal(adaptConnectedTools([toolkit]).length, 1);
	assert.throws(() => adaptConnectedTools([toolkit, makeTool()]), /multiple connected tools/i);
});

test('rejects missing and non-callable tools', () => {
	assert.throws(() => adaptConnectedTools([]), /at least one connected tool/i);
	assert.throws(() => adaptConnectedTools([{ name: 'broken' }]), /not callable/i);
});
