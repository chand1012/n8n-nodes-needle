export type JsonSchema = Record<string, unknown>;

export interface NeedleToolDefinition {
	name: string;
	description?: string;
	parameters: JsonSchema;
}

export type NeedleModelSource = 'builtIn' | 'custom';

export interface NeedleModelOptions {
	source: NeedleModelSource;
	path?: string;
}

export interface NeedleModel {
	key: string;
	path: string;
	bytes: Uint8Array;
	builtIn: boolean;
	mtimeMs: number;
	loadTimeMs: number;
}

export interface NeedleSessionOptions {
	system?: string;
	tools?: NeedleToolDefinition[];
	maxNewTokens?: number;
	outputBufferBytes?: number;
}

export interface NeedleFunctionCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface NeedleMetrics {
	durationMs: number;
	wasmInitializationMs: number;
	modelLoadMs: number;
	prefillTokensPerSecond?: number;
	decodeTokensPerSecond?: number;
	toolCount: number;
}

export interface NeedleResponse {
	type: 'call' | 'respond' | string;
	success: boolean;
	error: string | null;
	errorCode: string | null;
	functionCalls: NeedleFunctionCall[];
	reasoning?: string;
	response?: string;
	confidence: number;
	belowThreshold?: boolean;
	metrics: NeedleMetrics;
	raw: Record<string, unknown>;
}

export type NeedleSerializableValue =
	| string
	| number
	| boolean
	| null
	| NeedleSerializableValue[]
	| { [key: string]: NeedleSerializableValue };

export type NeedleChainStopReason = 'completed' | 'lowConfidence' | 'maxSteps';

export interface NeedleExecutedToolCall extends NeedleFunctionCall {
	result: NeedleSerializableValue;
}

export interface NeedleChainRound {
	step: number;
	input: string;
	response: NeedleResponse;
	executions: NeedleExecutedToolCall[];
}

export interface NeedleChainExecution {
	query: string;
	definedTools: NeedleToolDefinition[];
	results: NeedleSerializableValue[];
	rounds: NeedleChainRound[];
	finalResponse: NeedleResponse;
	stopReason: NeedleChainStopReason;
}

export interface NeedleChainOptions {
	model: NeedleModelOptions;
	system?: string;
	minimumConfidence?: number;
	maxSteps?: number;
	maxNewTokens?: number;
}

export type LowConfidenceBehavior = 'returnNormally' | 'markLowConfidence' | 'returnEmpty' | 'throwError';
