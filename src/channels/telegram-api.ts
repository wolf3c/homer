import type { TelegramUpdate } from "./telegram-contract.js";

export const TELEGRAM_UPDATES = ["message", "callback_query", "stopped_message_generation"] as const;
export type TelegramMethod = "getMe" | "getWebhookInfo" | "getUpdates" | "sendMessage" |
  "sendRichMessage" | "sendMessageDraft" | "sendRichMessageDraft" | "sendDocument" |
  "answerCallbackQuery" | "editMessageReplyMarkup";
export type TelegramFailure = "unauthorized" | "conflict" | "rate_limited" | "rejected" | "uncertain";

// Never include URLs, provider descriptions, request payloads or nested causes.
export class TelegramApiError extends Error {
  constructor(readonly code: TelegramFailure, readonly retryAfterMs = 0, readonly status = 0) {
    super("telegram_" + code);
    this.name = "TelegramApiError";
  }
}

export class TelegramApi {
  #token: string;
  constructor(token: string, private readonly transport: typeof fetch = fetch) {
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("telegram_invalid_token");
    this.#token = token;
  }
  async call<T>(method: TelegramMethod, body: Record<string, unknown> | FormData = {}, signal?: AbortSignal): Promise<T> {
    const combined = AbortSignal.any([AbortSignal.timeout(method === "getUpdates" ? 40_000 : 20_000), ...(signal ? [signal] : [])]);
    let response: Response;
    try {
      response = await this.transport(`https://api.telegram.org/bot${this.#token}/${method}`, {
        method: "POST", signal: combined, redirect: "error",
        ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch { throw new TelegramApiError("uncertain"); }
    if ([401, 403, 404].includes(response.status)) throw new TelegramApiError("unauthorized", 0, response.status);
    if (response.status === 409) throw new TelegramApiError("conflict", 0, response.status);
    let value: { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } };
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("missing_body");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { value: bytes, done } = await reader.read();
        if (done) break;
        size += bytes.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("large_body"); }
        chunks.push(bytes);
      }
      value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof value;
    }
    catch { throw new TelegramApiError("uncertain", 0, response.status); }
    if (response.ok && value?.ok === true && value.result !== undefined) return value.result;
    const status = value?.error_code ?? response.status;
    if (status === 401 || status === 403 || status === 404) throw new TelegramApiError("unauthorized", 0, status);
    if (status === 409) throw new TelegramApiError("conflict", 0, status);
    if (status === 429) {
      const seconds = value?.parameters?.retry_after;
      throw new TelegramApiError("rate_limited", typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 30_000, status);
    }
    if (status >= 400 && status < 500 && value?.ok === false) throw new TelegramApiError("rejected", 0, status);
    throw new TelegramApiError("uncertain", 0, status);
  }
  async inspect(signal?: AbortSignal) {
    const me = await this.call<{ id: number; is_bot: boolean }>("getMe", {}, signal);
    if (!Number.isSafeInteger(me.id) || me.id <= 0 || me.is_bot !== true) throw new Error("telegram_invalid_bot");
    const webhook = await this.call<{ url: string }>("getWebhookInfo", {}, signal);
    if (typeof webhook.url !== "string") throw new Error("telegram_invalid_webhook_response");
    if (webhook.url) throw new Error("telegram_existing_webhook");
    return String(me.id);
  }
  updates(offset?: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", { ...(offset === undefined ? {} : { offset }), limit: 100, timeout: 30, allowed_updates: TELEGRAM_UPDATES }, signal);
  }
  document(chatId: string, filename: string, bytes: Uint8Array, replyId?: number, signal?: AbortSignal) {
    if (!/^[\p{L}\p{N}_. -]{1,160}\.md$/u.test(filename) || bytes.length === 0 || bytes.length > 128 * 1024)
      throw new Error("telegram_invalid_artifact");
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("document", new Blob([Uint8Array.from(bytes)], { type: "text/markdown; charset=utf-8" }), filename);
    if (replyId !== undefined) form.set("reply_parameters", JSON.stringify({ message_id: replyId, allow_sending_without_reply: true }));
    return this.call<{ message_id: number }>("sendDocument", form, signal);
  }
}
