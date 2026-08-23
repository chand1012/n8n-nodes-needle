/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- A dedicated Needle Tool Calling Tool node supplies the Agent tool. */
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { adaptConnectedTools } from '../../langchain/connected-tool-adapter';
import { NeedleToolOrchestrator } from '../../runtime/NeedleToolOrchestrator';
import {
	formatChainOutput,
	getChainOptions,
	getChainOutputOptions,
	modelProperties,
	promptProperty,
} from '../shared/tool-calling';

export class NeedleToolCalling implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle Tool Calling',
		name: 'needleToolCalling',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Plan and execute chained n8n tool calls locally with Needle 2',
		subtitle: 'Chained Tool Calling',
		defaults: { name: 'Needle Tool Calling' },
		inputs: [
			{ type: NodeConnectionTypes.Main, displayName: '' },
			{
				type: NodeConnectionTypes.AiTool,
				displayName: 'Tools',
				required: true,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		builderHint: { inputs: { ai_tool: { required: true } } },
		properties: [
			promptProperty,
			...modelProperties,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const outputItems: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const outputOptions = getChainOutputOptions(this, itemIndex);
				const toolInputs = await this.getInputConnectionData(
					NodeConnectionTypes.AiTool,
					itemIndex,
				);
				const tools = adaptConnectedTools(toolInputs);
				const execution = await new NeedleToolOrchestrator().run(
					this.getNodeParameter('prompt', itemIndex) as string,
					tools,
					getChainOptions(this, itemIndex),
				);
				outputItems.push({
					json: formatChainOutput(
						execution,
						outputOptions.detailedOutput,
						outputOptions.includeMetrics,
					),
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				const nodeError = error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (!this.continueOnFail()) throw nodeError;
				outputItems.push({
					json: { ...inputItems[itemIndex].json, error: nodeError.message },
					binary: inputItems[itemIndex].binary,
					error: nodeError,
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [outputItems];
	}
}
