import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { supplyModel } from '@n8n/ai-node-sdk';

import {
	NeedleChatModel as NeedleLangChainChatModel,
} from '../../langchain/NeedleChatModel';
import type { LowConfidenceBehavior, NeedleModelOptions } from '../../runtime/types';

export class NeedleChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle Chat Model',
		name: 'needleChatModel',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Local Needle 2 tool-calling model for AI Agents',
		subtitle: 'Local Tool Model',
		defaults: { name: 'Needle Chat Model' },
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		properties: [
			{
				displayName: 'Model',
				name: 'modelSource',
				type: 'options',
				options: [
					{ name: 'Built-In Needle 2', value: 'builtIn' },
					{ name: 'Custom CACT File', value: 'custom' },
				],
				default: 'builtIn',
			},
			{
				displayName: 'Custom Model Path',
				name: 'modelPath',
				type: 'string',
				default: '',
				placeholder: '/models/needle/support.cact',
				description: 'Absolute path under N8N_NEEDLE_MODEL_DIRECTORY',
				displayOptions: { show: { modelSource: ['custom'] } },
			},
			{
				displayName: 'Minimum Confidence',
				name: 'minimumConfidence',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				default: 0.8,
			},
			{
				displayName: 'Low Confidence',
				name: 'lowConfidenceBehavior',
				type: 'options',
				options: [
					{ name: 'Continue', value: 'markLowConfidence' },
					{ name: 'Throw Model Error', value: 'throwError' },
				],
				default: 'throwError',
			},
			{
				displayName: 'System Facts',
				name: 'system',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				placeholder: 'date: 2026-08-10; locale: en-US',
				description: 'Optional facts merged with Agent system messages',
			},
			{
				displayName: 'Max New Tokens',
				name: 'maxNewTokens',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 2048 },
				default: 256,
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const modelSource = this.getNodeParameter('modelSource', itemIndex) as NeedleModelOptions['source'];
		return supplyModel(
			this,
			new NeedleLangChainChatModel({
				model: {
					source: modelSource,
					path: modelSource === 'custom' ? (this.getNodeParameter('modelPath', itemIndex) as string) : undefined,
				},
				minimumConfidence: this.getNodeParameter('minimumConfidence', itemIndex, 0.8) as number,
				lowConfidenceBehavior: this.getNodeParameter(
					'lowConfidenceBehavior',
					itemIndex,
				) as LowConfidenceBehavior,
				system: this.getNodeParameter('system', itemIndex, '') as string,
				maxNewTokens: this.getNodeParameter('maxNewTokens', itemIndex, 256) as number,
			}),
		);
	}
}
