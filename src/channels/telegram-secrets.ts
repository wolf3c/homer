import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import type { ReadStream, WriteStream } from "node:tty";
import { TelegramApi } from "./telegram-api.js";
import { TelegramStore } from "./telegram-store.js";

export interface TelegramSecrets {
  get(reference: string): Promise<string>;
  set(reference: string, token: string): Promise<void>;
  delete(reference: string): Promise<void>;
}
type SecretCommand = (args: string[], input?: string) => Promise<{ status: number; text: string }>;
const service = "Homer.Telegram.v1";
function validateReference(reference: string) {
  if (!/^telegram-[a-f0-9-]{36}$/.test(reference)) throw new Error("telegram_invalid_secret_reference");
}
export function validateTelegramToken(token: string) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("telegram_invalid_token");
  return token;
}

async function security(args: string[], input?: string) {
  if (process.platform !== "darwin") throw new Error("telegram_keychain_unavailable");
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    // Keychain belongs to the OS user, independently of the isolated shell HOME.
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: userInfo().homedir } });
    const chunks: Buffer[] = []; let size = 0;
    const timeout = setTimeout(() => { child.kill(); reject(new Error("telegram_keychain_unavailable")); }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size <= 8192) chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timeout); reject(new Error("telegram_keychain_unavailable")); });
    child.on("close", status => { clearTimeout(timeout); resolve({ status: status ?? 1, text: size > 8192 ? "" : Buffer.concat(chunks).toString("utf8").trim() }); });
    child.stdin.end(input);
  });
}

export class MacTelegramSecrets implements TelegramSecrets {
  constructor(private readonly command: SecretCommand = security) {}
  async get(reference: string) {
    validateReference(reference);
    const result = await this.command(["find-generic-password", "-s", service, "-a", reference, "-w"]);
    if (result.status !== 0) throw new Error("telegram_keychain_unavailable");
    try { return validateTelegramToken(Buffer.from(result.text, "base64").toString("utf8")); }
    catch { throw new Error("telegram_keychain_invalid"); }
  }
  async set(reference: string, token: string) {
    validateReference(reference); validateTelegramToken(token);
    // security's interactive command gets only safe Base64 via stdin; no shell,
    // token argv, inherited output, plaintext file or update of other apps' items.
    const encoded = Buffer.from(token).toString("base64");
    const result = await this.command(["-i"], `add-generic-password -s ${service} -a ${reference} -w ${encoded}\n`);
    if (result.status !== 0) throw new Error("telegram_keychain_unavailable");
    // Interactive security can exit zero after a command failure. Verify readback.
    const saved = await this.command(["find-generic-password", "-s", service, "-a", reference, "-w"]);
    const a = Buffer.from(encoded), b = Buffer.from(saved.text);
    if (saved.status !== 0 || a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("telegram_keychain_unavailable");
  }
  async delete(reference: string) {
    validateReference(reference);
    const result = await this.command(["delete-generic-password", "-s", service, "-a", reference]);
    if (result.status !== 0 && result.status !== 44) throw new Error("telegram_keychain_unavailable");
  }
}

// The existing trusted local host exposes this operation. Never expose it as a
// Telegram command, model tool, URL query parameter or token-bearing argv.
export class TelegramSettings {
  constructor(readonly store: TelegramStore, readonly secrets: TelegramSecrets, readonly conversationId: string,
    private readonly createApi: (token: string) => TelegramApi = token => new TelegramApi(token)) {
    store.db.exec("CREATE TABLE IF NOT EXISTS tg_credentials(botId TEXT PRIMARY KEY,reference TEXT NOT NULL)");
  }
  async configure(token: string) {
    validateTelegramToken(token);
    const botId = await this.createApi(token).inspect(); // no mutation or webhook deletion
    const previous = this.store.db.prepare("SELECT reference FROM tg_credentials WHERE botId=?").get(botId) as { reference: string } | undefined;
    const reference = "telegram-" + randomUUID();
    await this.secrets.set(reference, token);
    try {
      this.store.atomic(() => {
        this.store.configure(botId, this.conversationId);
        this.store.enabled(botId, false);
        this.store.db.prepare("INSERT INTO tg_credentials VALUES(?,?) ON CONFLICT(botId) DO UPDATE SET reference=excluded.reference").run(botId, reference);
      });
    } catch (error) { await this.secrets.delete(reference).catch(() => {}); throw error; }
    if (previous) await this.secrets.delete(previous.reference);
    return { botId, bound: this.store.connection(botId)!.ownerId !== null };
  }
  async api(botId: string) {
    const row = this.store.db.prepare("SELECT reference FROM tg_credentials WHERE botId=?").get(botId) as { reference: string } | undefined;
    if (!row) throw new Error("telegram_not_configured");
    return this.createApi(await this.secrets.get(row.reference));
  }
  async forget(botId: string) {
    // Host must first abort and await its adapter. Revoke routing before deleting secret.
    this.store.unbind(botId);
    const row = this.store.db.prepare("SELECT reference FROM tg_credentials WHERE botId=?").get(botId) as { reference: string } | undefined;
    if (row) await this.secrets.delete(row.reference);
    this.store.db.prepare("DELETE FROM tg_credentials WHERE botId=?").run(botId);
  }
}

export function readTelegramToken(input: ReadStream = process.stdin, output: WriteStream = process.stderr): Promise<string> {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new Error("telegram_trusted_tty_required"));
  output.write("Telegram Bot Token（隐藏输入，仅本地保存）：");
  const wasRaw = input.isRaw, wasPaused = input.isPaused();
  input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => { input.removeListener("data", data); input.removeListener("end", end); input.removeListener("error", end); input.setRawMode(wasRaw); if (wasPaused) input.pause(); output.write("\n"); };
    const end = () => { cleanup(); value = ""; reject(new Error("telegram_token_input_cancelled")); };
    const data = (chunk: Buffer) => {
      for (const c of chunk.toString("utf8")) {
        if (c === "\u0003" || c === "\u0004") { end(); return; }
        if (c === "\r" || c === "\n") {
          cleanup(); try { resolve(validateTelegramToken(value)); } catch { reject(new Error("telegram_invalid_token")); } value = ""; return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
        if (value.length > 128) { end(); return; }
      }
    };
    input.on("data", data); input.once("end", end); input.once("error", end);
  });
}
