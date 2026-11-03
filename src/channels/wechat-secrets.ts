import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import type { WechatCredential } from "./wechat-api.js";
import { WechatError, wechatUrl } from "./wechat-api.js";

export interface WechatSecrets {
  get(reference: string): Promise<WechatCredential>;
  set(reference: string, value: WechatCredential): Promise<void>;
  delete(reference: string): Promise<void>;
}
function validateReference(reference: string) {
  if (!/^wechat-[a-f0-9-]{36}$/.test(reference)) throw new WechatError("wechat_secret_reference_invalid");
}
export function validateWechatCredential(value: unknown): WechatCredential {
  if (!value || typeof value !== "object") throw new WechatError("wechat_credentials_invalid");
  const c = value as WechatCredential;
  if (![c.botToken, c.botId, c.ownerId, c.baseUrl].every(x => typeof x === "string" && x.length > 0 && x.length <= 8192) || !/^[a-f0-9]{64}$/.test(c.dataKey))
    throw new WechatError("wechat_credentials_invalid");
  wechatUrl(c.baseUrl);
  return c;
}
// Own Keychain entries only. Secret bytes travel through stdin, never argv or a shell.
export class MacWechatSecrets implements WechatSecrets {
  private async run(args: string[], input?: string): Promise<{ status: number; text: string }> {
    if (process.platform !== "darwin") throw new WechatError("wechat_keychain_unavailable");
    return new Promise((resolve, reject) => {
      // Keychain belongs to the OS user, independently of the isolated shell HOME.
      const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: userInfo().homedir } });
      const chunks: Buffer[] = []; let bytes = 0;
      const timeout = setTimeout(() => { child.kill(); reject(new WechatError("wechat_keychain_unavailable")); }, 15000);
      child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes < 65536) chunks.push(chunk); });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timeout); reject(new WechatError("wechat_keychain_unavailable")); });
      child.on("close", status => { clearTimeout(timeout); resolve({ status: status ?? 1, text: Buffer.concat(chunks).toString("utf8").trim() }); });
      child.stdin.end(input);
    });
  }
  async get(reference: string) {
    validateReference(reference);
    const result = await this.run(["find-generic-password", "-s", "Homer.Wechat.v1", "-a", reference, "-w"]);
    if (result.status !== 0) throw new WechatError("wechat_keychain_unavailable");
    try { return validateWechatCredential(JSON.parse(Buffer.from(result.text, "base64").toString("utf8"))); }
    catch { throw new WechatError("wechat_credentials_invalid"); }
  }
  async set(reference: string, value: WechatCredential) {
    validateReference(reference); validateWechatCredential(value);
    // Base64 makes the security interactive command grammar unambiguous.
    // It is decoded by get() after reading the dedicated item.
    const text = JSON.stringify(value);
    const encoded = Buffer.from(text).toString("base64");
    const result = await this.run(["-i"], `add-generic-password -s Homer.Wechat.v1 -a ${reference} -w ${encoded}\n`);
    if (result.status !== 0) throw new WechatError("wechat_keychain_unavailable");
    const saved = await this.run(["find-generic-password", "-s", "Homer.Wechat.v1", "-a", reference, "-w"]);
    const expected = Buffer.from(encoded), actual = Buffer.from(saved.text);
    if (saved.status !== 0 || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new WechatError("wechat_keychain_unavailable");
  }
  async delete(reference: string) {
    validateReference(reference);
    const result = await this.run(["delete-generic-password", "-s", "Homer.Wechat.v1", "-a", reference]);
    if (result.status !== 0 && result.status !== 44) throw new WechatError("wechat_keychain_unavailable");
  }
}
