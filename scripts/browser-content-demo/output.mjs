import {mkdir, mkdtemp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const scratchRoot = fileURLToPath(new URL('../../.codex/scratch/', import.meta.url));

export async function createDemoOutput(prefix) {
  await mkdir(scratchRoot, {recursive: true});
  if (process.env.DEMO_OUTPUT) {
    const output = resolve(process.env.DEMO_OUTPUT);
    await mkdir(output, {recursive: true});
    return output;
  }
  return mkdtemp(join(scratchRoot, prefix));
}
