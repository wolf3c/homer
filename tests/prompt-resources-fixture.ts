import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const scratch=resolve('.codex/scratch/worker-interactions/prompt-tests');
export function fixture() {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "resources-"));
  const directory = pathToFileURL(root + "/");
  const write = (name: string, text: string) => writeFileSync(join(root, name + ".md"), text);
  write("main", "Synthetic main A"); write("worker", "Synthetic worker A");
  return { root, directory, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
