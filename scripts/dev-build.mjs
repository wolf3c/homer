import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync, rmSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { spawn, fork } from "node:child_process";
import {copyRuntimeDependencies,sealBuild,freezeToolchain} from "./trusted-build.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const roots = ["scripts", "src", "prompts", "assets", "ui", ".codex/skills/homer-tool-management", ".codex/skills/homer-feedback", ".codex/skills/homer-archive-review"];
const excluded = path => path.replaceAll("\\", "/").split("/").some(part => part === "node_modules" || part === "dist" || part === ".vite" || part === ".DS_Store");
export function sourceSnapshot(root, configPath) {
  const files = new Map();
  function visit(path) {
    if (excluded(path)) return;
    if (!existsSync(join(root, path))) return;
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new Error("dev_source_symlink_unsupported");
    if (stat.isDirectory()) for (const item of readdirSync(join(root, path)).sort()) visit(join(path, item));
    else if (stat.isFile()) files.set(path.replaceAll("\\", "/"), readFileSync(join(root, path)));
  }
  for (const path of [...roots, "package.json", "package-lock.json", "tsconfig.json"]) visit(path);
  const configBytes = configPath ? readFileSync(configPath) : Buffer.from("");
  const hash = digest(Buffer.concat([...files].flatMap(([name, bytes]) => [Buffer.from(name + "\0"), bytes, Buffer.from("\0")]).concat(configBytes)));
  return { files, configBytes, hash };
}
export function backendHash(snapshot) {
  return digest(Buffer.concat([...snapshot.files].filter(([path]) => !path.startsWith("ui/")).flatMap(([path, bytes]) => [Buffer.from(path + "\0"), bytes, Buffer.from("\0")]).concat(snapshot.configBytes)));
}
export function uiHash(snapshot) {
  return digest(Buffer.concat([...snapshot.files].filter(([path]) => path.startsWith("ui/") && !path.endsWith("DESIGN.md")).flatMap(([path, bytes]) => [Buffer.from(path + "\0"), bytes, Buffer.from("\0")])));
}
function copySnapshot(root, snapshot, directory, toolRoot=root) {
  mkdirSync(directory, { recursive: true });
  for (const [path, bytes] of snapshot.files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  }
  symlinkSync(join(toolRoot, "node_modules"), join(directory, "node_modules"), "dir");
}
async function compileUi(root, snapshot, directory, signal) {
  if (!snapshot.files.has("ui/package.json")) return;
  await command(process.execPath, [join(directory, "scripts/build-preview-annotation.mjs")], directory, signal);
  await command(process.execPath, [join(directory, "scripts/build-run-activity-css.mjs"), "--check"], directory, signal);
  await command(process.execPath, [join(directory, "scripts/build-run-activity-css.mjs"), "--tool-fallback", "--check"], directory, signal);
  await command(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", join(directory, "ui/tsconfig.json")], root, signal);
  await command(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--configLoader", "runner", "--base", `/ui/${uiHash(snapshot)}/`, "--config", join(directory, "ui/vite.config.ts")], join(directory, "ui"), signal);
}
export function trustedHash(snapshot) {
  return digest(Buffer.concat([...snapshot.files].filter(([path]) => (/^(src|ui|assets)\//.test(path)||["package.json","tsconfig.json"].includes(path))).flatMap(([path,bytes])=>[Buffer.from(path+"\0"),bytes,Buffer.from("\0")]).concat(snapshot.configBytes??Buffer.alloc(0))));
}
export function gatewayFingerprint(snapshot) {
  return digest(Buffer.concat([...snapshot.files.keys()].filter(path=>path.startsWith("scripts/")||["src/mobile-turn.ts", "src/homer-account.ts", "src/mobile-devices.ts", "src/mobile-gateway.ts", "src/mobile-route.ts", "src/mobile-signaling.ts", "src/mobile-channel.ts", "src/mobile-session.ts", "src/mobile-rtc.ts", "src/web-chat.ts", "src/state-publication.ts", "src/web-server.ts", "src/web-contract.ts", "src/web-connection.ts", "src/update-review-page.ts", "src/web-upload.ts", "src/media-policy.ts", "src/web-history.ts", "src/processes.ts"].includes(path)).sort().flatMap(path => [Buffer.from(path+"\0"),snapshot.files.get(path)??Buffer.alloc(0),Buffer.from("\0")])));
}
export async function buildUiCandidate(root, configPath, snapshot, baseline, signal) {
  if (dependencyHash(snapshot) !== baseline.deps) throw Error("dev_dependencies_changed_restart_required");
  const protocol = JSON.parse(String(snapshot.files.get("ui/protocol.json") ?? '{}')).version;
  if (protocol !== baseline.webProtocol) throw Error("dev_web_protocol_incompatible");
  if (gatewayFingerprint(snapshot) !== baseline.gatewayHash) throw Error("dev_gateway_changed_restart_required");
  if(trustedHash(snapshot)!==baseline.trustedHash&&baseline.reviewedSourceHash!==snapshot.hash)throw Error("dev_trusted_review_required");
  const directory = join(root, ".codex/scratch/dev-upgrade/builds", "ui-" + uiHash(snapshot).slice(0, 12) + "-" + randomUUID());
  try {
    copySnapshot(root, snapshot, directory, baseline.toolchainRoot??root);
    await compileUi(baseline?.toolchainRoot??root, snapshot, directory, signal);
    if (uiHash(sourceSnapshot(root, configPath)) !== uiHash(snapshot)) throw Error("dev_candidate_superseded");
    return sealBuild({directory,hash:snapshot.hash,config:baseline.config,uiHash:uiHash(snapshot),trustedHash:trustedHash(snapshot)},baseline.dependenciesDirectory);
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
export function dependencyHash(snapshot) {
  const p = JSON.parse(snapshot.files.get("package.json"));
  return digest(JSON.stringify([p.dependencies, p.devDependencies, p.engines, p.type, String(snapshot.files.get("package-lock.json")), String(snapshot.files.get("ui/package.json") ?? "")]));
}
// Every SQLite schema owner participates in the reviewed upgrade boundary.
export function schemaHash(snapshot) {
  return digest(Buffer.concat(["src/mobile-devices.ts", "src/store.ts", "src/media-store.ts", "src/recursive-tasks.ts", "src/worker-interactions.ts", "src/web-history.ts"].map(path => snapshot.files.get(path) ?? Buffer.from(""))));
}
export function command(bin, args, cwd, signal) {
  return new Promise((done, reject) => {
    const child = spawn(bin, args, { cwd, stdio: "ignore", signal, timeout: 30000 });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done() : reject(new Error("dev_candidate_check_failed")));
  });
}
export async function buildCandidate(root, configPath, snapshot, baseline, signal) {
  const deps = dependencyHash(snapshot), schema = schemaHash(snapshot);
  if (baseline && deps !== baseline.deps) throw new Error("dev_dependencies_changed_restart_required");
  if (baseline && schema !== baseline.schema) throw new Error("dev_schema_change_requires_review");
  if (baseline && trustedHash(snapshot)!==baseline.trustedHash && baseline.reviewedSourceHash!==snapshot.hash) throw Error("dev_trusted_review_required");
  const directory = join(root, ".codex/scratch/dev-upgrade/builds", snapshot.hash.slice(0, 12) + "-" + randomUUID());
  let sealed;
  try {
  copySnapshot(root, snapshot, directory,baseline?.toolchainRoot??root);
  const tsconfig = JSON.parse(snapshot.files.get("tsconfig.json"));
  if (tsconfig.extends || tsconfig.compilerOptions?.plugins || tsconfig.compilerOptions?.rootDir !== "src" || tsconfig.compilerOptions?.outDir !== "dist")
    throw new Error("dev_build_configuration_unsupported");
  await command(process.execPath, [join(baseline?.toolchainRoot??root, "node_modules/typescript/bin/tsc"), "-p", join(directory, "tsconfig.json")], root, signal);
  writeFileSync(join(directory,'dist/media-documents.py'),snapshot.files.get('src/media-documents.py')??'');
  await compileUi(baseline?.toolchainRoot??root, snapshot, directory, signal);
  // Seal before importing any newly reviewed host code. The initial invocation
  // is an explicit trusted launcher start; subsequent code requires the gateway receipt.
  const runtime = baseline?.config.runtime;
  if(runtime) sealed=sealBuild({directory,hash:snapshot.hash,config:baseline.config},baseline.dependenciesDirectory);
  const inspectionDirectory=sealed?.directory??directory;
  // Imports validate prompt/asset resolution without launching Codex or sending messages.
  const { config, toolsHash, webProtocol } = await new Promise((accept, reject) => {
    const child = fork(join(baseline?.directory??root, "scripts/dev-inspect.mjs"), [inspectionDirectory, configPath ?? ""], {
      cwd: root, execPath: process.execPath, execArgv: ["--disable-warning=ExperimentalWarning"], stdio: ["ignore", "ignore", "ignore", "ipc"], signal, timeout: 15000,
    });
    let inspected;
    child.on("message", value => { inspected = value; });
    child.once("error", reject);
    child.once("exit", code => code === 0 && inspected ? accept(inspected) : reject(new Error("dev_candidate_import_failed")));
  });
  if (baseline && baseline.webProtocol !== webProtocol) throw Error("dev_web_protocol_incompatible");
  const gatewayHash = gatewayFingerprint(snapshot);
  if (baseline && baseline.gatewayHash !== gatewayHash) throw Error("dev_gateway_changed_restart_required");
  if (baseline && baseline.toolsHash !== toolsHash) throw new Error("main_tools_migration_required");
  const boundary = digest(JSON.stringify([config.runtime, config.workspace, config.codexBin, config.codexHome, config.baseUrl, config.keyEnv, config.requiresOpenaiAuth]));
  if (baseline && baseline.boundary !== boundary) throw new Error("dev_connection_or_runtime_changed_restart_required");
  if (sourceSnapshot(root, configPath).hash !== snapshot.hash) throw new Error("dev_candidate_superseded");
  if (snapshot.files.has("ui/package.json") && JSON.parse(String(snapshot.files.get("ui/protocol.json") ?? '{}')).version !== webProtocol) throw Error("dev_web_protocol_incompatible");
  const build = { trustedHash:trustedHash(snapshot),gatewayHash, backendHash: backendHash(snapshot), uiHash: uiHash(snapshot), webProtocol, directory, version: snapshot.hash.slice(0, 12), hash: snapshot.hash, deps, schema, toolsHash, config, boundary };
  const dependenciesDirectory=baseline?.dependenciesDirectory??copyRuntimeDependencies(root,config.runtime);
  const toolchainRoot=baseline?.toolchainRoot??freezeToolchain(root,config.runtime);
  return {...build,...(sealed??sealBuild(build,dependenciesDirectory)),config,dependenciesDirectory,toolchainRoot};
  } catch (error) {
    if(sealed)rmSync(sealed.directory,{recursive:true,force:true});
    rmSync(directory, {recursive:true, force:true});throw error;
  }
}

export function candidateGuard(snapshot,baseline){
 if(baseline.snapshot&&!snapshot.configBytes.equals(baseline.snapshot.configBytes))throw Error("dev_configuration_changed_restart_required");
 if(dependencyHash(snapshot)!==baseline.deps)throw Error("dev_dependencies_changed_restart_required");
 if(schemaHash(snapshot)!==baseline.schema)throw Error("dev_schema_change_requires_review");
 if(gatewayFingerprint(snapshot)!==baseline.gatewayHash)throw Error("dev_gateway_changed_restart_required");
}
export function supportedChange(root, path) {
  const name = relative(root, resolve(root, path)).replaceAll("\\", "/");
  return !excluded(name) && [...roots.map(r => r + "/"), "package.json", "package-lock.json", "tsconfig.json"].some(r => r.endsWith("/") ? name.startsWith(r) : name === r);
}
