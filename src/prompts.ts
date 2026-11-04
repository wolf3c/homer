import { readFileSync } from "node:fs";

export type Prompts = Readonly<{ main: string; worker: string }>;
const resources = new URL("../prompts/", import.meta.url);
const lifecycleAuthority = "## 临时资源生命周期授权\n\n任务授权包含 Agent 为完成本任务自行创建、仅服务本任务的临时资源的必要生命周期管理：核实已无用途、无独有价值且无其他依赖后，可在原任务范围内回收，无须逐项再次申请。用户原有、共享、持久、归属不明及仍有用途的资源不在该许可内；用户明确限制和宿主审批继续生效。";

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
    return text.trim() + "\n\n" + lifecycleAuthority;
  };
  return Object.freeze({main:read("main.md"),worker:read("worker.md")});
}
