import { getParametersJsonSchema, type Tool } from '@n8n/ai-node-sdk';

import { NeedleSchemaError } from '../runtime/errors';
import type { NeedleToolDefinition } from '../runtime/types';

export function adaptTools(tools: Tool[]): NeedleToolDefinition[] {
	return tools.map((tool, index) => {
		if (tool.type !== 'function') {
			throw new NeedleSchemaError(
				`Needle cannot convert provider-defined tool ${index + 1} (${tool.name}).`,
			);
		}
		try {
			return {
				name: tool.name,
				description: tool.description,
				parameters: getParametersJsonSchema(tool) as Record<string, unknown>,
			};
		} catch (error) {
			throw new NeedleSchemaError(`n8n tool ${index + 1} could not be converted.`, {
				cause: error,
			});
		}
	});
}
