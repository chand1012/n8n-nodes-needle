import type { Message } from '@n8n/ai-node-sdk';

export interface AdaptedNeedleMessages {
	system: string;
	inputs: string[];
}

export function adaptMessages(messages: Message[], configuredSystem = ''): AdaptedNeedleMessages {
	const systemParts = configuredSystem ? [configuredSystem] : [];
	const inputs: string[] = [];
	let pendingToolResults: unknown[] = [];

	const flushTools = (): void => {
		if (pendingToolResults.length === 0) return;
		inputs.push(JSON.stringify(pendingToolResults));
		pendingToolResults = [];
	};

	for (const message of messages) {
		if (message.role === 'system') {
			systemParts.push(textContent(message));
			continue;
		}
		if (message.role === 'tool') {
			for (const content of message.content) {
				if (content.type === 'tool-result') pendingToolResults.push(content.result);
			}
			continue;
		}
		flushTools();
		if (message.role === 'user') inputs.push(textContent(message));
		// Assistant messages are outputs produced while the session is replayed.
	}
	flushTools();
	return { system: systemParts.filter(Boolean).join('; '), inputs };
}

function textContent(message: Message): string {
	return message.content
		.flatMap((content) =>
			content.type === 'text' || content.type === 'reasoning' ? [content.text] : [],
		)
		.join('\n');
}
