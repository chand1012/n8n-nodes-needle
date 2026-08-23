import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Needle } from '../../nodes/Needle/Needle.node.ts';
import { NeedleSentimentAnalysis } from '../../nodes/NeedleSentimentAnalysis/NeedleSentimentAnalysis.node.ts';
import { NeedleToolCalling } from '../../nodes/NeedleToolCalling/NeedleToolCalling.node.ts';
import { NeedleToolCallingTool } from '../../nodes/NeedleToolCallingTool/NeedleToolCallingTool.node.ts';

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

test('registers both chained tool calling nodes with the correct connections', async () => {
	const packageUrl = new URL('../../package.json', import.meta.url);
	const packageJson = JSON.parse(await readFile(packageUrl, 'utf8')) as {
		n8n?: { nodes?: string[] };
	};
	const workflowNode = new NeedleToolCalling().description;
	const agentToolNode = new NeedleToolCallingTool().description;

	assert.ok(packageJson.n8n?.nodes?.includes('dist/nodes/NeedleToolCalling/NeedleToolCalling.node.js'));
	assert.ok(packageJson.n8n?.nodes?.includes('dist/nodes/NeedleToolCallingTool/NeedleToolCallingTool.node.js'));
	assert.deepEqual(
		workflowNode.inputs,
		[
			{ type: 'main', displayName: '' },
			{ type: 'ai_tool', displayName: 'Tools', required: true },
		],
	);
	assert.deepEqual(workflowNode.outputs, ['main']);
	assert.equal(typeof agentToolNode.inputs, 'object');
	assert.deepEqual(agentToolNode.outputs, ['ai_tool']);
	const workflowPrompt = workflowNode.properties.find(({ name }) => name === 'prompt');
	const agentToolPrompt = agentToolNode.properties.find(({ name }) => name === 'prompt');
	assert.ok(agentToolPrompt);
	assert.deepEqual(agentToolPrompt, workflowPrompt);
	assert.ok(!agentToolPrompt.noDataExpression);
	assert.ok(agentToolNode.codex?.categories?.includes('AI'));
	assert.ok(agentToolNode.codex?.subcategories?.AI?.includes('Tools'));
});

test('keeps all shared Agent Tool settings identical to the standalone node', () => {
	const workflowProperties = new NeedleToolCalling().description.properties;
	const agentToolProperties = new NeedleToolCallingTool().description.properties;

	for (const workflowProperty of workflowProperties) {
		const agentToolProperty = agentToolProperties.find(
			({ name }) => name === workflowProperty.name,
		);
		assert.ok(agentToolProperty, `Missing shared property: ${workflowProperty.name}`);
		assert.deepEqual(agentToolProperty, workflowProperty);
	}

	const systemFacts = agentToolProperties.find(({ name }) => name === 'system');
	assert.ok(systemFacts);
	assert.ok(!systemFacts.noDataExpression);
});

test('does not register the removed Needle chat model', async () => {
	const packageUrl = new URL('../../package.json', import.meta.url);
	const packageJson = JSON.parse(await readFile(packageUrl, 'utf8')) as {
		n8n?: { nodes?: string[] };
	};
	assert.ok(!packageJson.n8n?.nodes?.some((node) => node.includes('NeedleChatModel')));
});
