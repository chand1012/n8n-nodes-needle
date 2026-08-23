/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- This node already supplies an AI Tool output. */
import { DynamicStructuredTool, DynamicTool } from '@langchain/core/tools';
import type {
	FromAIArgument,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	ISupplyDataFunctions,
	INodeType,
	INodeTypeDescription,
	SupplyData,
} from 'n8n-workflow';
import { extractFromAICalls, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { adaptConnectedTools } from '../../langchain/connected-tool-adapter';
import { NeedleToolOrchestrator } from '../../runtime/NeedleToolOrchestrator';
import {
	formatChainOutput,
	getChainOptions,
	getChainOutputOptions,
	modelProperties,
	promptProperty,
} from '../shared/tool-calling';

type ToolContext = ISupplyDataFunctions | IExecuteFunctions;
type NeedleAgentTool = DynamicStructuredTool | DynamicTool;

interface PromptBinding {
	aiArgument?: FromAIArgument;
	fixedPrompt?: string;
}

function getPromptBinding(context: ToolContext, itemIndex: number): PromptBinding {
	const rawPrompt = context.getNode().parameters.prompt;
	const aiArguments = typeof rawPrompt === 'string' ? extractFromAICalls(rawPrompt) : [];
	if (aiArguments.length > 1) {
		throw new NodeOperationError(
			context.getNode(),
			'Prompt can contain only one AI-filled value.',
		);
	}
	if (aiArguments[0]) return { aiArgument: aiArguments[0] };

	return {
		fixedPrompt: context.getNodeParameter('prompt', itemIndex, '') as string,
	};
}

export function normalizeNeedleToolInput(
	input: IDataObject,
	node: ReturnType<ToolContext['getNode']>,
	key = 'prompt',
): { prompt: string } {
	const prompt = input[key] ?? (key === 'prompt' ? undefined : input.prompt);
	if (typeof prompt !== 'string' || !prompt.trim()) {
		throw new NodeOperationError(
			node,
			'Needle Tool Calling Tool requires a non-empty prompt.',
		);
	}

	// Engine-driven AI tool execution can add bookkeeping fields to the input item.
	// Only pass the declared argument into LangChain's strict structured-tool schema.
	return { prompt };
}

async function getNeedleTool(
	context: ToolContext,
	itemIndex: number,
	logExecution = true,
): Promise<NeedleAgentTool> {
	const toolInputs = await context.getInputConnectionData(NodeConnectionTypes.AiTool, 0);
	const tools = adaptConnectedTools(toolInputs);
	const orchestrator = new NeedleToolOrchestrator();
	const outputOptions = getChainOutputOptions(context, itemIndex);
	const options = getChainOptions(context, itemIndex);
	const promptBinding = getPromptBinding(context, itemIndex);
	const name = context.getNodeParameter('toolName', itemIndex) as string;
	const description = context.getNodeParameter('toolDescription', itemIndex) as string;

	const invokePrompt = async (prompt: string): Promise<string> => {
			const runIndex = logExecution
				? context.addInputData(NodeConnectionTypes.AiTool, [[{ json: { prompt } }]]).index
				: undefined;
			try {
				normalizeNeedleToolInput({ prompt }, context.getNode());
				const execution = await orchestrator.run(prompt, tools, options);
				const output = formatChainOutput(
					execution,
					outputOptions.detailedOutput,
					outputOptions.includeMetrics,
				);
				if (runIndex !== undefined) {
					void context.addOutputData(
						NodeConnectionTypes.AiTool,
						runIndex,
						[[{ json: output }]],
					);
				}
				return JSON.stringify(output);
			} catch (error) {
				const nodeError = error instanceof NodeOperationError
					? error
					: new NodeOperationError(context.getNode(), error as Error);
				if (runIndex !== undefined) {
					void context.addOutputData(NodeConnectionTypes.AiTool, runIndex, nodeError);
				}
				throw nodeError;
			}
	};

	if (!promptBinding.aiArgument) {
		return new DynamicTool({
			name,
			description,
			func: async () => await invokePrompt(promptBinding.fixedPrompt ?? ''),
		});
	}

	const { key, description: argumentDescription, defaultValue } = promptBinding.aiArgument;
	if (!key) throw new NodeOperationError(context.getNode(), 'The AI-filled Prompt requires a name.');
	if (promptBinding.aiArgument.type && promptBinding.aiArgument.type !== 'string') {
		throw new NodeOperationError(
			context.getNode(),
			'The AI-filled Prompt must use the string type.',
		);
	}
	const promptSchema: Record<string, unknown> = {
		type: 'string',
		description: argumentDescription ?? 'Request to complete with the connected tools',
	};
	if (defaultValue !== undefined) promptSchema.default = defaultValue;

	return new DynamicStructuredTool({
		name,
		description,
		schema: {
			type: 'object',
			properties: { [key]: promptSchema },
			required: [key],
			additionalProperties: false,
		},
		func: async (input: IDataObject): Promise<string> => {
			const { prompt } = normalizeNeedleToolInput(input, context.getNode(), key);
			return await invokePrompt(prompt);
		},
	});
}

export class NeedleToolCallingTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Needle Tool Calling Tool',
		name: 'needleToolCallingTool',
		icon: 'file:needle.svg',
		group: ['transform'],
		version: 1,
		description: 'Give an AI Agent a fast local Needle orchestrator for connected tools',
		subtitle: 'Needle Agent Tool',
		defaults: { name: 'Needle Tool Calling Tool' },
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Other Tools'],
			},
			resources: {
				primaryDocumentation: [{
					url: 'https://github.com/chand1012/n8n-nodes-needle#needle-tool-calling-tool',
				}],
			},
		},
		inputs: [{
			type: NodeConnectionTypes.AiTool,
			displayName: 'Tools',
			required: true,
		}],
		outputs: [NodeConnectionTypes.AiTool],
		outputNames: ['Tool'],
		builderHint: { inputs: { ai_tool: { required: true } } },
		properties: [
			{
				displayName: 'Tool Name',
				name: 'toolName',
				type: 'string',
				default: 'needle_tool_calling',
				required: true,
				noDataExpression: true,
				validateType: 'string-alphanumeric',
				description: 'Name the parent Agent uses to call this tool',
			},
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				typeOptions: { rows: 3 },
				default: 'Plan and execute one or more connected tools for the supplied prompt.',
				required: true,
				noDataExpression: true,
				description: 'Explain to the parent Agent when it should delegate to Needle',
			},
			promptProperty,
			...modelProperties,
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		return {
			response: await getNeedleTool(this, itemIndex),
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const result: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const tool = await getNeedleTool(this, itemIndex, false);
				const promptBinding = getPromptBinding(this, itemIndex);
				const toolInput = promptBinding.aiArgument
					? {
						[promptBinding.aiArgument.key]: normalizeNeedleToolInput(
							items[itemIndex].json,
							this.getNode(),
							promptBinding.aiArgument.key,
						).prompt,
					}
					: '';
				result.push({
					json: { response: await tool.invoke(toolInput) },
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				const nodeError = error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (!this.continueOnFail()) throw nodeError;
				result.push({
					json: { error: nodeError.message },
					error: nodeError,
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [result];
	}
}
