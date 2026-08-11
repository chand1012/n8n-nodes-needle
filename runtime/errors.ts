export class NeedleError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
	}
}

export class NeedleInitializationError extends NeedleError {}
export class NeedleModelNotFoundError extends NeedleError {}
export class NeedleModelLoadError extends NeedleError {}
export class NeedleInferenceError extends NeedleError {}
export class NeedleLowConfidenceError extends NeedleError {}
export class NeedleSchemaError extends NeedleError {}
export class NeedleToolCallError extends NeedleError {}
