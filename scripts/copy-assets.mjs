import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('runtime/wasm');
const destination = path.resolve('dist/runtime/wasm');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
