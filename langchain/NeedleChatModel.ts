import {
	BaseChatModel,
	type ChatModelConfig,
	type GenerateResult,
	type Message,
	type StreamChunk,
	type Tool,
} from '@n8n/ai-node-sdk';

import { applyConfidencePolicy } from '../runtime/confidence';
import { NeedleInferenceError } from '../runtime/errors';
import { NeedleRuntime } from '../runtime/NeedleRuntime';
import type { LowConfidenceBehavior, NeedleModelOptions } from '../runtime/types';
import { adaptMessages } from './message-adapter';
import { adaptTools } from './tool-adapter';

export interface NeedleChatModelFields {
	model: NeedleModelOptions;
	minimumConfidence?: number;
	lowConfidenceBehavior?: LowConfidenceBehavior;
	maxNewTokens?: number;
	system?: string;
	runtime?: NeedleRuntime;
}

export class NeedleChatModel extends BaseChatModel {
	private readonly fields: Required<Omit<NeedleChatModelFields, 'runtime'>>;
	private readonly runtime: NeedleRuntime;

	constructor(fields: NeedleChatModelFields) {
		super('needle', fields.model.source === 'builtIn' ? 'needle2' : fields.model.path ?? 'custom');
		this.fields = {
			model: fields.model,
			minimumConfidence: fields.minimumConfidence ?? 0.8,
			lowConfidenceBehavior: fields.lowConfidenceBehavior ?? 'throwError',
			maxNewTokens: fields.maxNewTokens ?? 256,
			system: fields.system ?? '',
		};
		this.runtime = fields.runtime ?? NeedleRuntime.getInstance();
	}

	async generate(messages: Message[], config?: ChatModelConfig): Promise<GenerateResult> {
		const adaptedMessages = adaptMessages(messages, this.fields.system);
		if (adaptedMessages.inputs.length === 0) {
			throw new NeedleInferenceError('Needle requires at least one user or tool message.');
		}
		const model = await this.runtime.loadModel(this.fields.model);
		const session = await this.runtime.createSession(model, {
			tools: adaptTools(this.tools),
			system: adaptedMessages.system,
			maxNewTokens: config?.maxTokens ?? this.fields.maxNewTokens,
		});
		const rawResponse = await session.replay(adaptedMessages.inputs);
		const response = applyConfidencePolicy(
			rawResponse,
			this.fields.minimumConfidence,
			this.fields.lowConfidenceBehavior,
		);
		const content: Message['content'] = response
			? response.functionCalls.map((call, index) => ({
					type: 'tool-call' as const,
					toolCallId: `needle-${Date.now()}-${index}`,
					toolName: call.name,
					input: JSON.stringify(call.arguments),
				}))
			: [];
		if (response?.response) content.push({ type: 'text', text: response.response });
		if (response && content.length === 0) {
			content.push({
				type: 'text',
				text: 'Needle could not match the request to any connected tool.',
			});
		}

		return {
			finishReason: response?.functionCalls.length ? 'tool-calls' : 'stop',
			message: { role: 'assistant', content },
			providerMetadata: response
				? {
					confidence: response.confidence,
					belowThreshold: response.belowThreshold,
					reasoning: response.reasoning,
					metrics: response.metrics,
				}
				: { confidence: rawResponse.confidence, belowThreshold: true },
			rawResponse: response?.raw ?? rawResponse.raw,
		};
	}

	async *stream(messages: Message[], config?: ChatModelConfig): AsyncIterable<StreamChunk> {
		const result = await this.generate(messages, config);
		for (const content of result.message.content) yield { type: 'content', content };
		yield { type: 'finish', finishReason: result.finishReason ?? 'stop' };
	}

	withTools(tools: Tool[]): NeedleChatModel {
		return super.withTools(tools) as NeedleChatModel;
	}
}
