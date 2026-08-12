import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Needle } from '../../nodes/Needle/Needle.node.ts';

test('keeps the standalone Needle node in the regular workflow picker', async () => {
	const metadataUrl = new URL('../../nodes/Needle/Needle.node.json', import.meta.url);
	const metadata = JSON.parse(await readFile(metadataUrl, 'utf8')) as { categories?: string[] };

	assert.ok(metadata.categories?.includes('Data & Storage'));
	assert.ok(!metadata.categories?.includes('AI'));
});

test('exposes only function call selection in the standalone node', () => {
	const propertyNames = new Needle().description.properties.map(({ name }) => name);

	assert.ok(propertyNames.includes('prompt'));
	assert.ok(propertyNames.includes('tools'));
	assert.ok(!propertyNames.includes('operation'));
	assert.ok(!propertyNames.includes('jsonSchema'));
	assert.ok(!propertyNames.includes('labels'));
});
