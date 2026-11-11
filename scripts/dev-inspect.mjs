// Inspect candidate imports in an expendable process, never the terminal owner.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [directory, configPath] = process.argv.slice(2);
try {
  const { MAIN_TOOLS_HASH } = await import(pathToFileURL(join(directory, "dist/recursive-tools.js")).href);
  await import(pathToFileURL(join(directory, "dist/service.js")).href);
  const prompts = await import(pathToFileURL(join(directory, "dist/prompts.js")).href);
  if (typeof prompts.loadPrompts === "function") prompts.loadPrompts();
  const { loadConfig } = await import(pathToFileURL(join(directory, "dist/config.js")).href);
  const config = loadConfig(configPath || undefined);
  const { WEB_PROTOCOL } = await import(pathToFileURL(join(directory, "dist/web-contract.js")).href);
  process.send?.({ config, toolsHash: MAIN_TOOLS_HASH, webProtocol: WEB_PROTOCOL });
} catch {
  process.exitCode = 1;
} finally { process.disconnect?.(); }
