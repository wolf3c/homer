import { readFileSync } from "node:fs";

export type Prompts = Readonly<{ main: string; worker: string }>;
const resources = new URL("../prompts/", import.meta.url);

/** One immutable startup snapshot. Resources sit beside src/ or dist/, never cwd. */
export function loadPrompts(directory: URL = resources): Prompts {
  const read = (name: string): string => {
    let text: string;
    try {
      text = readFileSync(new URL(name, directory), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new Error(`${code === "ENOENT" ? "prompt_file_missing" : "prompt_file_unreadable"}:${name}`);
    }
    if (!text.trim()) throw new Error(`prompt_file_empty:${name}`);
    return text.trim();
  };
  return Object.freeze({main:read("main.md"),worker:read("worker.md")});
}
