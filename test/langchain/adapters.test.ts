import assert from 'node:assert/strict';
import test from 'node:test';

import type { Message, Tool } from '@n8n/ai-node-sdk';
import { z } from 'zod';

import { adaptMessages } from '../../langchain/message-adapter';
import { adaptTools } from '../../langchain/tool-adapter';

test('groups tool results while preserving user turns and system facts', () => {
	const messages: Message[] = [
		{ role: 'system', content: [{ type: 'text', text: 'date: 2026-08-10' }] },
		{ role: 'user', content: [{ type: 'text', text: 'Find the customer' }] },
		{
			role: 'tool',
			content: [{ type: 'tool-result', toolCallId: 'call-1', result: { id: 42 } }],
		},
		{ role: 'user', content: [{ type: 'text', text: 'Send the invoice' }] },
	];
	const adapted = adaptMessages(messages);
	assert.equal(adapted.system, 'date: 2026-08-10');
	assert.deepEqual(adapted.inputs, ['Find the customer', '[{"id":42}]', 'Send the invoice']);
});

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
