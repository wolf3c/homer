import type { TelegramChannel } from "./telegram-channel.js";

export type TelegramManagedState = ReturnType<TelegramChannel["view"]>;
export interface TelegramManagementBridge {
  state(): Promise<TelegramManagedState>;
  configure(token: string): Promise<TelegramManagedState>;
  beginPairing(): Promise<{ code: string; expiresInSeconds: number }>;
  candidate(code: string): Promise<{ userId: string; chatId: string } | null>;
  approve(code: string, userId: string, chatId: string): Promise<TelegramManagedState>;
  connect(): Promise<TelegramManagedState>;
  disconnect(): Promise<TelegramManagedState>;
  forget(): Promise<TelegramManagedState>;
}
const pairCode = (code: string) => { if (typeof code !== "string" || !/^[a-f0-9]{32}$/.test(code)) throw new Error("telegram_invalid_pairing_code"); };
const stableId = (id: string) => { if (typeof id !== "string" || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error("telegram_invalid_owner_id"); };

// Trusted local management RPC only. The existing web host must check loopback,
// exact Host/Origin and JSON POST before invoking; never expose this as an Agent tool.
export class TelegramManagement implements TelegramManagementBridge {
  constructor(readonly channel: TelegramChannel) {}
  async state() { return this.channel.view(); }
  configure(token: string) {
    if (typeof token !== "string" || !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("telegram_invalid_token");
    return this.channel.configureLocal(token);
  }
  beginPairing() { return this.channel.beginPairing(); }
  async candidate(code: string) { pairCode(code); return this.channel.pairingCandidate(code); }
  approve(code: string, userId: string, chatId: string) {
    pairCode(code); stableId(userId); stableId(chatId);
    return this.channel.approvePairing(code, userId, chatId);
  }
  connect() { return this.channel.connect(); }
  disconnect() { return this.channel.disconnect(); }
  forget() { return this.channel.forget(); }
  canUpgrade() { return this.channel.canUpgrade(); }
  close() { return this.channel.close(); }
}
