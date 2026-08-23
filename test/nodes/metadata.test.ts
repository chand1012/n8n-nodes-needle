import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Needle } from '../../nodes/Needle/Needle.node.ts';
import { NeedleSentimentAnalysis } from '../../nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.ts';

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

test('registers the sentiment node as a regular workflow node', async () => {
	const packageUrl = new URL('../../package.json', import.meta.url);
	const packageJson = JSON.parse(await readFile(packageUrl, 'utf8')) as {
		n8n?: { nodes?: string[] };
	};
	const description = new NeedleSentimentAnalysis().description;

	assert.ok(
		packageJson.n8n?.nodes?.includes(
			'dist/nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.js',
		),
	);
	assert.deepEqual(description.inputs, ['main']);
	assert.equal(description.name, 'needleSentimentAnalysis');
});
