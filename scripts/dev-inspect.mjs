// Inspect candidate imports in an expendable process, never the terminal owner.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const [directory, configPath] = process.argv.slice(2);
try {
  const tools = await import(pathToFileURL(join(directory, "dist/tools.js")).href);
  await import(pathToFileURL(join(directory, "dist/service.js")).href);
  const prompts = await import(pathToFileURL(join(directory, "dist/prompts.js")).href);
  if (typeof prompts.loadPrompts === "function") prompts.loadPrompts();
  const { loadConfig } = await import(pathToFileURL(join(directory, "dist/config.js")).href);
  const config = loadConfig(configPath || undefined);
  const toolsHash = createHash("sha256").update(JSON.stringify(tools.MAIN_TOOLS)).digest("hex");
  const { WEB_PROTOCOL } = await import(pathToFileURL(join(directory, "dist/web-contract.js")).href);
  process.send?.({ config, toolsHash, webProtocol: WEB_PROTOCOL });
} catch {
  process.exitCode = 1;
} finally { process.disconnect?.(); }
