import type { NeedleModel, NeedleResponse, NeedleSessionOptions } from './types';
import type { NeedleRuntime } from './NeedleRuntime';

export class NeedleSession {
	constructor(
		private readonly runtime: NeedleRuntime,
		readonly model: NeedleModel,
		readonly options: NeedleSessionOptions,
	) {}

	async complete(input: string): Promise<NeedleResponse> {
		return await this.runtime.execute(this, [input]);
	}

	async replay(inputs: string[]): Promise<NeedleResponse> {
		if (inputs.length === 0) throw new Error('A Needle session requires at least one input.');
		return await this.runtime.execute(this, inputs);
	}

	async run<T>(
		callback: (complete: (input: string) => NeedleResponse) => Promise<T>,
	): Promise<T> {
		return await this.runtime.runSession(this, callback);
	}
}
