import type { DatabaseSync } from "node:sqlite";
import { TelegramAdapter, type TelegramStatus } from "./telegram-adapter.js";
import { TelegramApi } from "./telegram-api.js";
import type { TelegramHost, TelegramHostEvent } from "./telegram-contract.js";
import { MacTelegramSecrets, TelegramSettings, type TelegramSecrets } from "./telegram-secrets.js";
import { TelegramStore } from "./telegram-store.js";
import { recordTelegramOutput } from "./telegram-output.js";

type ChannelOptions = { secrets?: TelegramSecrets; createApi?: (token: string) => TelegramApi; now?: () => number };

// Trusted local host facade. No HTTP listener or Homer instance is created here.
// Local settings handlers must enforce OS-user/session authentication themselves.
export class TelegramChannel {
  readonly store: TelegramStore;
  readonly settings: TelegramSettings;
  #adapter: TelegramAdapter | undefined;
  #status: TelegramStatus = "offline";
  #localOperation: Promise<unknown> = Promise.resolve();
  #closed = false;
  #operations = 0;
  constructor(db: DatabaseSync, private readonly host: TelegramHost, readonly conversationId: string, private readonly options: ChannelOptions = {}) {
    this.store = new TelegramStore(db);
    this.settings = new TelegramSettings(this.store, options.secrets ?? new MacTelegramSecrets(), conversationId, options.createApi);
  }
  private connection() {
    const rows = this.store.db.prepare("SELECT botId FROM tg_credentials").all() as { botId: string }[];
    if (rows.length > 1) throw new Error("telegram_multiple_bots_unsupported");
    return rows[0] ? this.store.connection(rows[0].botId) : undefined;
  }
  view() {
    const c = this.connection();
    const count = (table: "tg_inbox" | "tg_outbox", state: string) => c ? Number(this.store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE botId=? AND state=?`).get(c.botId, state)?.n ?? 0) : 0;
    return { status: this.#status, configured: !!c, enabled: !!c?.enabled, bound: !!c?.ownerId,
      ...(c ? { botId: c.botId, ownerId: c.ownerId, chatId: c.chatId, bindingVersion: c.version } : {}),
      pending: count("tg_outbox", "pending"), uncertain: count("tg_outbox", "uncertain"), failed: count("tg_outbox", "failed"), heldInputs: count("tg_inbox", "held"), uncertainInputs: count("tg_inbox", "uncertain") };
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.#operations++;
    const next = this.#localOperation.then(() => { if (this.#closed) throw new Error("telegram_channel_closed"); return fn(); }).finally(() => { this.#operations--; });
    this.#localOperation = next.catch(() => {});
    return next;
  }
  canUpgrade() { return !this.#closed && this.#operations === 0 && (this.#adapter?.canUpgrade() ?? true); }
  configureLocal(token: string) {
    return this.exclusive(async () => {
      const existing = this.connection();
      // Inspect first so an accidental second bot cannot replace the existing setup.
      const createApi = this.options.createApi ?? (input => new TelegramApi(input));
      const botId = await createApi(token).inspect();
      if (existing && existing.botId !== botId) throw new Error("telegram_unbind_previous_bot_first");
      await this.#adapter?.close(true); this.#adapter = undefined;
      await this.settings.configure(token);
      this.#status = "offline";
      return this.view();
    });
  }
  connect() { return this.exclusive(() => this.doConnect()); }
  private async doConnect() {
    const c = this.connection();
    if (!c) throw new Error("telegram_not_configured");
    if (c.conversationId !== this.conversationId) throw new Error("telegram_conversation_mismatch");
    await this.#adapter?.close(); this.#adapter = undefined;
    const api = await this.settings.api(c.botId); // fail closed before enabling on secret read failure
    this.store.enabled(c.botId, true);
    const adapter = new TelegramAdapter(c.botId, this.store, api, this.host, status => { this.#status = status; }, this.options.now);
    this.#adapter = adapter;
    try { await adapter.start(); } catch (error) { await adapter.close(true); this.#adapter = undefined; throw error; }
    return this.view();
  }
  restore() { return this.exclusive(async () => this.connection()?.enabled ? this.doConnect() : this.view()); }
  disconnect() {
    return this.exclusive(async () => {
      const c = this.connection(); if (c) this.store.enabled(c.botId, false);
      await this.#adapter?.close(true); this.#adapter = undefined; this.#status = "offline";
      return this.view();
    });
  }
  beginPairing() {
    return this.exclusive(async () => {
      const c = this.connection(); if (!c) throw new Error("telegram_not_configured");
      return { code: this.store.pairing(c.botId, this.options.now?.()), expiresInSeconds: 600 };
    });
  }
  pairingCandidate(code: string) {
    const c = this.connection(); if (!c) throw new Error("telegram_not_configured");
    // No code hash or arbitrary raw Telegram update is returned to the browser.
    return this.store.pairCandidate(c.botId, code, this.options.now?.());
  }
  approvePairing(code: string, userId: string, chatId: string) {
    return this.exclusive(async () => {
      const c = this.connection(); if (!c) throw new Error("telegram_not_configured");
      this.store.approvePair(c.botId, code, userId, chatId, this.options.now?.());
      return this.view();
    });
  }
  forget() {
    return this.exclusive(async () => {
      await this.#adapter?.close(true); this.#adapter = undefined;
      const c = this.connection(); if (c) await this.settings.forget(c.botId);
      this.#status = "offline"; return this.view();
    });
  }
  async event(event: TelegramHostEvent) {
    if (this.#closed) return;
    if (this.#adapter) await this.#adapter.event(event);
    else recordTelegramOutput(this.store, event, this.options.now?.() ?? Date.now(), () => { this.#status = "presentation_degraded"; });
  }
  async close() {
    this.#closed = true;
    await this.#localOperation;
    await this.#adapter?.close(); this.#adapter = undefined;
  }
}
