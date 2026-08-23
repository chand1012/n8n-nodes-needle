import type { Tool as N8nTool } from '@n8n/ai-node-sdk';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { NeedleSchemaError } from '../runtime/errors';
import type {
	NeedleSerializableValue,
	NeedleToolDefinition,
} from '../runtime/types';
import { adaptTools } from './tool-adapter';

interface ToolLike {
	name?: unknown;
	description?: unknown;
	schema?: unknown;
	invoke?: unknown;
}

interface ToolkitLike {
	getTools(): unknown[];
}

export interface ConnectedNeedleTool {
	definition: NeedleToolDefinition;
	invoke(arguments_: Record<string, unknown>): Promise<NeedleSerializableValue>;
}

export function adaptConnectedTools(inputs: unknown): ConnectedNeedleTool[] {
	if (!Array.isArray(inputs) || inputs.length === 0) {
		throw new NeedleSchemaError('Needle Tool Calling requires at least one connected tool.');
	}

	const candidates = inputs.flatMap((input, index) => expandToolkit(input, index));
	const seenNames = new Set<string>();
	return candidates.map((candidate, index) => {
		const tool = toToolLike(candidate, index);
		const name = typeof tool.name === 'string' ? tool.name.trim() : '';
		if (!name) throw new NeedleSchemaError(`Connected tool ${index + 1} requires a name.`);
		if (seenNames.has(name)) {
			throw new NeedleSchemaError(
				`Multiple connected tools use the name \`${name}\`. Rename them to make every tool name unique.`,
			);
		}
		seenNames.add(name);

		const description = typeof tool.description === 'string' ? tool.description : undefined;
		const parameters = convertSchema(tool, name);
		return {
			definition: { name, description, parameters },
			invoke: async (arguments_) => serializeToolResult(
				await (tool.invoke as (input: unknown) => Promise<unknown>)(arguments_),
				name,
			),
		};
	});
}

function expandToolkit(input: unknown, index: number): unknown[] {
	if (!input || typeof input !== 'object') {
		throw new NeedleSchemaError(`Connected tool ${index + 1} is not a callable tool.`);
	}
	if (typeof (input as Partial<ToolkitLike>).getTools !== 'function') return [input];
	const tools = (input as ToolkitLike).getTools();
	if (!Array.isArray(tools)) {
		throw new NeedleSchemaError(`Connected toolkit ${index + 1} did not return a tool array.`);
	}
	return tools;
}

function toToolLike(value: unknown, index: number): ToolLike {
	if (!value || typeof value !== 'object' || typeof (value as ToolLike).invoke !== 'function') {
		throw new NeedleSchemaError(`Connected tool ${index + 1} is not callable.`);
	}
	return value as ToolLike;
}

function convertSchema(tool: ToolLike, name: string): Record<string, unknown> {
	if (!tool.schema || typeof tool.schema !== 'object') {
		return stringInputSchema();
	}
	try {
		const [definition] = adaptTools([{
			type: 'function',
			name,
			description: typeof tool.description === 'string' ? tool.description : undefined,
			inputSchema: tool.schema,
		} as Extract<N8nTool, { type: 'function' }>]);
		const parameters = isJsonSchema(definition.parameters)
			? definition.parameters
			: toJsonSchema(tool.schema as Parameters<typeof toJsonSchema>[0]) as Record<string, unknown>;
		if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
			throw new Error('The converted schema is not a JSON object.');
		}
		return normalizeStringInputSchema(parameters);
	} catch (error) {
		throw new NeedleSchemaError(`Connected tool \`${name}\` has an unsupported input schema.`, {
			cause: error,
		});
	}
}

function isJsonSchema(value: Record<string, unknown>): boolean {
	return typeof value.type === 'string' || typeof value.$ref === 'string' || value.properties !== undefined;
}

function normalizeStringInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const properties = schema.properties;
	if (
		schema.type === 'object' &&
		properties &&
		typeof properties === 'object' &&
		!Array.isArray(properties) &&
		Object.keys(properties).length === 1 &&
		'input' in properties
	) {
		return { ...schema, required: ['input'] };
	}
	return schema;
}

function stringInputSchema(): Record<string, unknown> {
	return {
		type: 'object',
		properties: {
			input: { type: 'string', description: 'Input passed to the tool' },
		},
		required: ['input'],
		additionalProperties: false,
	};
}

export function serializeToolResult(value: unknown, toolName: string): NeedleSerializableValue {
	if (value === undefined) {
		throw new NeedleSchemaError(`Connected tool \`${toolName}\` returned undefined.`);
	}
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as NeedleSerializableValue;
		} catch {
			return value;
		}
	}
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new Error('The result has no JSON representation.');
		}
		return JSON.parse(serialized) as NeedleSerializableValue;
	} catch (error) {
		throw new NeedleSchemaError(
			`Connected tool \`${toolName}\` returned a result that is not JSON-serializable.`,
			{ cause: error },
		);
	}
}
