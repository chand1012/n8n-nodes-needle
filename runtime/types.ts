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

export type LowConfidenceBehavior = 'returnNormally' | 'markLowConfidence' | 'returnEmpty' | 'throwError';
