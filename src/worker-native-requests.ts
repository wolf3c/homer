import { createHash } from "node:crypto";
import { nativeInteraction, nativeResponse, NATIVE_INTERACTION_METHODS, type NativeInteraction } from "./worker-interaction-protocol.js";
import type { InteractionResolution } from "./worker-interactions.js";

export type NativeRequest = NativeInteraction & { requestId: string | number; isCurrent?: () => boolean };
type Entry = {
  request: NativeRequest;
  fingerprint: string;
  completion: Promise<void>;
  cancel: () => void;
  ended: boolean;
  sent: boolean;
  owner: { threadId?: string; turnId?: string };
};
type Hooks = {
  worker?: boolean;
  current: () => { active: boolean; threadId?: string; turnId?: string };
  forward: (request: NativeRequest) => Promise<InteractionResolution>;
  send: (message: unknown) => void;
  delivered: (requestId: string | number) => void;
  invalidated: (requestId: string | number, code: string) => void;
  changed?: () => void;
};
function classification(error: unknown) {
  return error instanceof Error && /^(?:interaction_|native_approval_|capability_)[a-z_]{1,70}$/.test(error.message) ? error.message : "interaction_unavailable";
}

// Owns native callbacks for ONE AppServer process. It cannot resurrect callbacks
// from SQLite and it never replays a decision after exit, turn end, or resolution.
export class WorkerNativeRequests {
  private entries = new Map<string | number, Entry>();
  private closed = false;
  constructor(private hooks: Hooks) {}
  get hasPending() { return [...this.entries.values()].some(entry => !entry.ended && !entry.sent); }
  private bound(request: NativeInteraction, owner?: Entry['owner']) {
    const current = this.hooks.current();
    return !this.closed && current.active && !!current.threadId && !!current.turnId &&
      (!owner || current.threadId === owner.threadId && current.turnId === owner.turnId) &&
      (this.hooks.worker || current.threadId === request.threadId && current.turnId === request.turnId);
  }
  private error(id: string | number, code: string) {
    if (!this.closed) this.hooks.send({ id, error: { code: -32001, message: code } });
  }
  async receive(id: string | number, method: string, params: unknown): Promise<boolean> {
    if (!(NATIVE_INTERACTION_METHODS as readonly string[]).includes(method)) return false;
    if (this.closed) return true;
    const prior = this.entries.get(id);
    let fingerprint: string;
    try { fingerprint = createHash("sha256").update(JSON.stringify([method, params])).digest("hex"); }
    catch (error) {
      const code = prior ? "interaction_request_conflict" : classification(error);
      if (prior) this.invalidate(prior, code); else this.hooks.invalidated(id, code);
      this.error(id, code);
      return true;
    }
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        this.invalidate(prior, "interaction_request_conflict");
        this.error(id, "interaction_request_conflict");
      } else await prior.completion;
      return true;
    }
    let parsed: NativeInteraction | undefined;
    try { parsed = nativeInteraction(method, params); }
    catch (error) { const code = classification(error); this.hooks.invalidated(id, code); this.error(id, code); return true; }
    const request: NativeRequest = { ...parsed!, requestId: id };
    if (!this.bound(request)) {
      this.hooks.invalidated(id, "interaction_scope_denied");
      if (request.kind === "question" || method === "mcpServer/elicitation/request") this.error(id, "interaction_scope_denied");
      else this.hooks.send({ id, result: nativeResponse(request, { action: "deny", reason: "interaction_scope_denied" }) });
      return true;
    }
    let cancel!: () => void;
    const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
    const entry: Entry = { request, fingerprint, completion: Promise.resolve(), cancel, ended: false, sent: false, owner: this.hooks.current() };
    request.isCurrent = () => !entry.ended && this.bound(request, entry.owner);
    this.entries.set(id, entry);
    this.hooks.changed?.();
    entry.completion = (async () => {
      let sending = false;
      try {
        const resolution = await Promise.race([this.hooks.forward(request), cancelled]);
        if (entry.ended || !resolution) return;
        if (!this.bound(request, entry.owner)) { this.invalidate(entry, "worker_not_live"); return; }
        if ((resolution.status === "cancelled" || resolution.status === "expired") && resolution.decision?.action !== "cancel") {
          this.invalidate(entry, resolution.code ?? "worker_not_live");
          // A still-running server receives an explicit refusal, never an empty answer.
          if (request.method === "mcpServer/elicitation/request") { sending = true; this.error(id, resolution.code ?? "interaction_cancelled"); }
          else if (request.kind === "authorization") { sending = true; this.hooks.send({ id, result: nativeResponse(request, { action: "deny", reason: "worker_not_live" }) }); }
          else this.error(id, "interaction_cancelled");
          return;
        }
        if (!resolution.decision) throw new Error("interaction_decision_missing");
        const result = nativeResponse(request, resolution.decision);
        sending = true;
        this.hooks.send({ id, result });
        entry.sent = true;
      } catch (error) {
        if (entry.ended) return;
        const code = sending ? "interaction_send_failed" : classification(error);
        const canReply = !sending && this.bound(request, entry.owner);
        this.invalidate(entry, code);
        if (canReply) this.error(id, code);
      } finally {
        this.hooks.changed?.();
      }
    })();
    await entry.completion;
    return true;
  }
  private invalidate(entry: Entry, code: string) {
    if (entry.ended) return;
    entry.ended = true;
    entry.cancel();
    this.hooks.invalidated(entry.request.requestId, code);
    this.hooks.changed?.();
  }
  resolved(threadId: string, requestId: string | number) {
    const entry = this.entries.get(requestId);
    if (!entry || entry.ended || entry.request.threadId !== threadId) return;
    if (entry.sent) {
      try { this.hooks.delivered(requestId); }
      finally { entry.ended = true; }
    } else this.invalidate(entry, "server_request_cleared");
  }
  endTurn(turnId: string, threadId = this.hooks.current().threadId) {
    for (const entry of this.entries.values())
      if (entry.owner.turnId === turnId && entry.owner.threadId === threadId ||
          entry.request.turnId === turnId && entry.request.threadId === threadId) this.invalidate(entry, "worker_turn_ended");
  }
  close() {
    this.closed = true;
    for (const entry of this.entries.values()) this.invalidate(entry, "worker_process_exited");
    this.entries.clear();
  }
}
