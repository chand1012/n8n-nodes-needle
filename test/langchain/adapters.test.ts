import assert from 'node:assert/strict';
import test from 'node:test';

import type { Tool } from '@n8n/ai-node-sdk';
import { z } from 'zod';

import { adaptTools } from '../../langchain/tool-adapter';

test('converts nested n8n tool schemas without losing constraints', () => {
	const n8nTool: Tool = {
		type: 'function',
		name: 'book_trip',
		description: 'Book a trip',
		inputSchema: z.object({
			mode: z.enum(['train', 'plane']).describe('Travel mode'),
			passengers: z.array(z.object({ name: z.string() })).min(1),
		}),
	};
	const [converted] = adaptTools([n8nTool]);
	assert.equal(converted.name, 'book_trip');
	const properties = converted.parameters.properties as Record<string, Record<string, unknown>>;
	assert.deepEqual(properties.mode.enum, ['train', 'plane']);
	assert.equal(properties.passengers.type, 'array');
});
