import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['runtime/**/*.ts', 'langchain/**/*.ts', 'nodes/Needle/Needle.node.ts'],
		rules: {
			'@n8n/community-nodes/require-node-api-error': 'off',
			'n8n-nodes-base/node-execute-block-wrong-error-thrown': 'off',
		},
	},
	{
		// @n8n/node-cli 0.33.1 reports the documented scoped SDK as the unscoped name.
		files: ['package.json'],
		rules: { '@n8n/community-nodes/valid-peer-dependencies': 'off' },
	},
];
