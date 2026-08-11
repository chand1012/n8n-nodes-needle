import { NeedleLowConfidenceError } from './errors';
import type { LowConfidenceBehavior, NeedleResponse } from './types';

export function applyConfidencePolicy(
	response: NeedleResponse,
	minimumConfidence: number,
	behavior: LowConfidenceBehavior,
): NeedleResponse | null {
	const belowThreshold = response.confidence < minimumConfidence;
	if (!belowThreshold) return { ...response, belowThreshold: false };

	switch (behavior) {
		case 'returnEmpty':
			return null;
		case 'throwError':
			throw new NeedleLowConfidenceError(
				`Needle confidence ${response.confidence.toFixed(3)} is below the ${minimumConfidence.toFixed(3)} threshold.`,
			);
		case 'markLowConfidence':
			return { ...response, belowThreshold: true };
		case 'returnNormally':
		default:
			return response;
	}
}
