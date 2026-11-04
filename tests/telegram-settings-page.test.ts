import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { telegramSettingsJs, telegramSettingsHtml } from "../src/channels/telegram-settings-page.js";

// HMR-TELEGRAM-SAVE-001: real reported inert Save button; synthetic UI peers:
// execute the actual served JS with deterministic DOM/fetch/timers, never network.
const token = "123456:synthetic_settings_fixture_123456789";
const state = { configured: false, enabled: false, bound: false, status: "offline", pending: 0, uncertain: 0, failed: 0, uncertainInputs: 0, heldInputs: 0 };
class Element {
  textContent = ""; value = ""; disabled = false; hidden = false; focused = false; scrolled = false;
  onclick?: () => unknown;
  readonly listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  readonly attributes = new Map<string, string>();
  addEventListener(name: string, fn: (event: { preventDefault(): void }) => void) { this.listeners.set(name, fn); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function ui(configure: (signal: AbortSignal) => Promise<Response>, getState = async () => Response.json(state)) {
  const elements = new Map<string, Element>();
  for (const id of ["token", "credentials", "save", "status", "error", "counts", "connect", "pair", "disconnect", "forget", "pair-code", "candidate", "approve"]) elements.set(id, new Element());
  elements.get("error")!.hidden = true;
  elements.get("save")!.textContent = "验证并安全保存";
  const buttons = ["save", "connect", "pair", "disconnect", "forget", "approve"].map(id => elements.get(id)!);
  const timeouts = new Map<number, { fn: () => void; ms: number }>(); let nextId = 0, submissions = 0, receivedToken = false;
  let interval = () => {};
  const context = {
    document: { hidden: false, getElementById: (id: string) => elements.get(id), querySelectorAll: () => buttons },
    window: { addEventListener() {} }, AbortController, Date, Error, JSON,
    setTimeout(fn: () => void, ms: number) { const id = ++nextId; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout(id: number) { timeouts.delete(id); }, setInterval(fn: () => void) { interval = fn; return 0; }, clearInterval() {}, confirm: () => false,
    async fetch(path: string, init?: RequestInit) {
      assert.equal(new Headers(init?.headers).has("X-Homer-Connection"),false);assert.equal(init?.credentials,"omit");
      if (path === "/api/channels/telegram") return getState();
      assert.equal(path, "/api/channels/telegram/configure"); submissions++;
      receivedToken = (JSON.parse(String(init?.body)) as { token: string }).token === token;
      return configure(init?.signal as AbortSignal);
    },
  };
  new Script(telegramSettingsJs).runInNewContext(context);
  return { elements, timeouts, submissions: () => submissions, receivedToken: () => receivedToken,
    tick() { interval(); },
    submit() { elements.get("token")!.value = token; elements.get("credentials")!.listeners.get("submit")!({ preventDefault() {} }); },
  };
}

test("TG Save actually submits once, immediately exposes progress, clears secret, then reports success", async () => {
  let complete!: (response: Response) => void;
  const f = ui(() => new Promise(resolve => { complete = resolve; })); await flush();
  f.submit();
  assert.equal(f.submissions(), 1); assert.equal(f.receivedToken(), true);
  assert.equal(f.elements.get("token")!.value, "");
  assert.equal(f.elements.get("save")!.disabled, true);
  assert.match(f.elements.get("status")!.textContent, /正在验证/);
  assert.match(f.elements.get("save")!.textContent, /正在验证/);
  f.elements.get("credentials")!.listeners.get("submit")!({ preventDefault() {} });
  assert.equal(f.submissions(), 1);
  complete(Response.json({ ...state, configured: true })); await flush();
  assert.match(f.elements.get("status")!.textContent, /已验证.*安全保存/);
  assert.equal(f.elements.get("save")!.disabled, false);
  assert.equal(f.elements.get("error")!.hidden, true);
});

test("TG Save stable failures are visible, focused and scrolled to without reflecting provider text or secret", async () => {
  const f = ui(async () => Response.json({ error: "telegram_keychain_unavailable", details: token }, { status: 409 })); await flush();
  f.submit(); await flush();
  const error = f.elements.get("error")!;
  assert.equal(error.hidden, false); assert.equal(error.focused, true); assert.equal(error.scrolled, true);
  assert.match(error.textContent, /钥匙串/); assert.equal(error.textContent.includes(token), false);
  assert.equal(f.elements.get("save")!.disabled, false);
  assert.match(telegramSettingsHtml, /id="error"[^>]*tabindex="-1"/);
});

test("TG Save has a bounded unknown-result deadline including response body stalls and does not auto retry", async () => {
  for (const stallBody of [false, true]) {
    let signal!: AbortSignal;
    const f = ui(async value => { signal = value; return stallBody ? { ok: true, json: () => new Promise(() => {}) } as Response : new Promise(() => {}); }); await flush();
    f.submit(); await flush();
    const deadline = [...f.timeouts.values()].find(timer => timer.ms === 95000);
    assert.ok(deadline, "configure must bound the 90s RPC receipt, not wait forever");
    deadline.fn(); await flush();
    assert.equal(signal.aborted, true);
    assert.equal(f.elements.get("error")!.hidden, false);
    assert.match(f.elements.get("error")!.textContent, /超时.*未确认/);
    assert.match(f.elements.get("error")!.textContent, /不要重复|勿重复/);
    assert.equal(f.elements.get("save")!.disabled, false);
    assert.equal(f.submissions(), 1);
  }
});

test("TG Save rejected fetch, malformed response and untrusted error codes produce sanitized failures", async () => {
  for (const configure of [async () => { throw new Error(token); }, async () => new Response("not-json"), async () => Response.json({ error: token }, { status: 409 })]) {
    const f = ui(configure); await flush(); f.submit(); await flush();
    assert.equal(f.elements.get("error")!.hidden, false);
    assert.equal(f.elements.get("error")!.textContent.includes(token), false);
    assert.equal(f.elements.get("save")!.disabled, false);
  }
});

test("TG late periodic state cannot overwrite an in-progress Save", async () => {
  let resolveState!: (response: Response) => void, resolveSave!: (response: Response) => void, reads = 0;
  const f = ui(() => new Promise(resolve => { resolveSave = resolve; }), async () => ++reads === 1 ? Response.json(state) : new Promise(resolve => { resolveState = resolve; }));
  await flush(); f.tick(); f.submit();
  resolveState(Response.json(state)); await flush();
  assert.match(f.elements.get("status")!.textContent, /正在验证/);
  assert.equal(f.elements.get("save")!.disabled, true);
  resolveSave(Response.json({ ...state, configured: true })); await flush();
  assert.match(f.elements.get("status")!.textContent, /已验证.*安全保存/);
});
