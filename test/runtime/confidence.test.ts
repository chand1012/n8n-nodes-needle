import assert from 'node:assert/strict';
import test from 'node:test';

import { applyConfidencePolicy } from '../../runtime/confidence';
import { NeedleLowConfidenceError } from '../../runtime/errors';
import type { NeedleResponse } from '../../runtime/types';

const response: NeedleResponse = {
	type: 'call',
	success: true,
	error: null,
	errorCode: null,
	functionCalls: [],
	confidence: 0.4,
	metrics: { durationMs: 1, wasmInitializationMs: 1, modelLoadMs: 1, toolCount: 0 },
	raw: {},
};

test('marks low-confidence responses', () => {
	assert.equal(applyConfidencePolicy(response, 0.8, 'markLowConfidence')?.belowThreshold, true);
});

test('returns null when low-confidence behavior is empty', () => {
	assert.equal(applyConfidencePolicy(response, 0.8, 'returnEmpty'), null);
});

test('throws a typed low-confidence error', () => {
	assert.throws(
		() => applyConfidencePolicy(response, 0.8, 'throwError'),
		NeedleLowConfidenceError,
	);
});
