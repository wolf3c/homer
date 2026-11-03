import QRCode from "qrcode";
import { WechatError } from "./wechat-api.js";
import type { WechatChannel, WechatLoginView } from "./wechat-channel.js";

export type WechatManagedLogin = Omit<WechatLoginView, "qrCodeUrl"> & { imagePath?: string };
export type WechatManagedState = ReturnType<WechatChannel["status"]> & { login?: WechatManagedLogin };
export interface WechatManagementBridge {
  state(): Promise<WechatManagedState>;
  beginLogin(): Promise<WechatManagedLogin>;
  pollLogin(id: string, verifyCode?: string): Promise<WechatManagedLogin>;
  qrPng(id: string): Promise<string>;
  disable(): Promise<WechatManagedState>;
  reconnect(): Promise<WechatManagedState>;
  disconnect(): Promise<WechatManagedState>;
}

// Login payload and generated PNG remain in this process. Public management
// responses contain only a short-lived same-origin image path, never the URL.
export class WechatManagement implements WechatManagementBridge {
  private login?: WechatLoginView;
  private revision = 0;
  constructor(private channel: WechatChannel, private afterReconnect: () => Promise<void> = async () => {}) {}
  private view(): WechatManagedLogin | undefined {
    const login = this.login;
    if (!login) return;
    if (login.expiresAt && Date.now() >= login.expiresAt && !["confirmed", "already_bound"].includes(login.status)) {
      login.status = "expired"; delete login.qrCodeUrl;
    }
    const { qrCodeUrl, ...safe } = login;
    return { ...safe, ...(qrCodeUrl && ["wait", "scaned"].includes(login.status) ? { imagePath: `/api/channels/wechat/login/${login.id}/qr.png` } : {}) };
  }
  async state(): Promise<WechatManagedState> { const login = this.view(); return { ...this.channel.status(), ...(login ? { login } : {}) }; }
  canUpgrade() {
    const login = this.view();
    return this.channel.canUpgrade() && (!login || ["expired", "confirmed", "already_bound", "verify_code_blocked", "error"].includes(login.status));
  }
  async beginLogin() {
    const revision = ++this.revision;
    this.login = undefined;
    const login = await this.channel.beginLogin();
    if (revision !== this.revision) throw new WechatError("wechat_connection_superseded");
    this.login = login; return this.view()!;
  }
  async pollLogin(id: string, verifyCode?: string) {
    if (this.login?.id !== id) throw new WechatError("wechat_login_not_active");
    const revision = this.revision, expiresAt = this.login.expiresAt;
    let login: WechatLoginView;
    try { login = await this.channel.pollLogin(id, verifyCode); }
    catch (error) {
      if (revision === this.revision && this.channel.status().status === "error")
        this.login = { id, status: "error", ...(error instanceof WechatError ? { error: error.code } : {}) };
      throw error;
    }
    if (revision !== this.revision) throw new WechatError("wechat_connection_superseded");
    this.login = { ...login, expiresAt: login.expiresAt ?? expiresAt };
    return this.view()!;
  }
  async qrPng(id: string) {
    const view = this.view(), revision = this.revision;
    if (!view?.imagePath || view.id !== id || !this.login?.qrCodeUrl) throw new WechatError("wechat_login_not_active");
    const bytes = await QRCode.toBuffer(this.login.qrCodeUrl, { type: "png", width: 320, margin: 4, errorCorrectionLevel: "M" });
    if (revision !== this.revision || this.view()?.imagePath !== view.imagePath) throw new WechatError("wechat_login_not_active");
    return bytes.toString("base64");
  }
  private clear() { this.revision++; this.login = undefined; }
  async disable() { this.clear(); this.channel.disable(); return this.state(); }
  async reconnect() { this.clear(); await this.channel.reconnect(); await this.afterReconnect(); return this.state(); }
  async disconnect() { this.clear(); await this.channel.disconnect(); return this.state(); }
  async close() { this.clear(); await this.channel.close(); }
}
