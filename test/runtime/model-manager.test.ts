import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NeedleModelLoadError } from '../../runtime/errors';
import { NeedleModelManager } from '../../runtime/NeedleModelManager';

test('allows models below the configured canonical directory', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'needle-models-'));
	const nested = path.join(root, 'custom');
	await mkdir(nested);
	const modelPath = path.join(nested, 'model.cact');
	await writeFile(modelPath, new Uint8Array([1, 2, 3]));
	const model = await new NeedleModelManager({ modelDirectory: root }).load({
		source: 'custom',
		path: modelPath,
	});
	assert.equal(model.path, await realpath(modelPath));
	assert.deepEqual([...model.bytes], [1, 2, 3]);
});

test('rejects a symlink escaping the configured model directory', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'needle-models-'));
	const outside = await mkdtemp(path.join(tmpdir(), 'needle-outside-'));
	const outsideModel = path.join(outside, 'secret.cact');
	const linkedModel = path.join(root, 'linked.cact');
	await writeFile(outsideModel, new Uint8Array([1]));
	await symlink(outsideModel, linkedModel);
	await assert.rejects(
		new NeedleModelManager({ modelDirectory: root }).load({ source: 'custom', path: linkedModel }),
		NeedleModelLoadError,
	);
});

test('invalidates cached bytes when file metadata changes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'needle-models-'));
	const modelPath = path.join(root, 'model.cact');
	const manager = new NeedleModelManager({ modelDirectory: root });
	await writeFile(modelPath, new Uint8Array([1]));
	const first = await manager.load({ source: 'custom', path: modelPath });
	await writeFile(modelPath, new Uint8Array([2, 3]));
	const second = await manager.load({ source: 'custom', path: modelPath });
	assert.notEqual(first.key, second.key);
	assert.deepEqual([...second.bytes], [2, 3]);
});
