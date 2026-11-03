import { CommittedDatabase } from "./committed-database.js";
import { randomUUID } from "node:crypto";

export type Status =
  | "queued"
  | "running"
  | "awaiting_review"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";
export type Run = {
  id: string;
  matterId: string;
  requestId: string;
  sourceRequestId?: string | null;
  goal: string;
  material: string;
  status: Status;
  threadId: string | null;
  turnId: string | null;
  pid: number | null;
  startedAt: number | null;
  endedAt: number | null;
  stopRequestedAt: number | null;
  stopReason: string | null;
  errorCode: string | null;
  artifact: string | null;
  summary: string | null;
  delivery: string;
  usage: string | null;
  createdAt: number;
};
export type Matter = {
  id: string;
  title: string;
  status: Status;
  createdAt: number;
};
export type Dispatch = {
  requestId: string;
  sourceRequestId?: string | null;
  matterId?: string;
  title: string;
  goal: string;
  material: string;
};
export class Store {
  readonly db: CommittedDatabase;
  constructor(path: string) {
    this.db = new CommittedDatabase(path);
    // Reject unsupported versions before changing the database.
    const hasMeta = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (hasMeta) {
      const pending = this.meta("pendingSchemaVersion");
      if (pending !== undefined && pending !== "1") { this.db.close(); throw new Error("pending_schema_unsupported"); }
      const recursive = this.meta("recursiveSchemaVersion");
      if (recursive !== undefined && recursive !== "1" && recursive !== "2" && recursive !== "3" && recursive !== "4") { this.db.close(); throw new Error("recursive_schema_unsupported"); }
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS matters(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,matterId TEXT NOT NULL REFERENCES matters(id),requestId TEXT NOT NULL UNIQUE,goal TEXT NOT NULL,material TEXT NOT NULL,status TEXT NOT NULL,threadId TEXT,turnId TEXT,pid INTEGER,startedAt INTEGER,endedAt INTEGER,stopRequestedAt INTEGER,stopReason TEXT,errorCode TEXT,artifact TEXT,summary TEXT,delivery TEXT NOT NULL DEFAULT 'pending',usage TEXT,createdAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,runId TEXT REFERENCES runs(id),type TEXT NOT NULL,code TEXT,at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT,createdAt INTEGER NOT NULL);
  `);
    // Additive migration: retain existing runs and their request identifiers.
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    if (!columns.some(c => c.name === "sourceRequestId"))
      this.db.exec("ALTER TABLE runs ADD COLUMN sourceRequestId TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS runs_source_request ON runs(sourceRequestId)");
  }
  close() {
    this.db.close();
  }
  meta(key: string): string | undefined {
    return (
      this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as
        | { value: string }
        | undefined
    )?.value;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  run(id: string): Run | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      | Run
      | undefined;
  }
  runs(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs ORDER BY createdAt,rowid")
      .all() as Run[];
  }
  matters(ids?:readonly string[]): Matter[] {
    return (ids===undefined
      ? this.db.prepare("SELECT * FROM matters ORDER BY createdAt,rowid").all()
      : this.db.prepare("SELECT * FROM matters WHERE id IN (SELECT value FROM json_each(?)) ORDER BY createdAt,rowid").all(JSON.stringify(ids))) as Matter[];
  }
  events(runId: string) {
    return this.db
      .prepare("SELECT * FROM events WHERE runId=? ORDER BY seq")
      .all(runId) as {
      seq: number;
      type: string;
      code: string | null;
      at: number;
    }[];
  }
  event(runId: string | null, type: string, code: string | null = null) {
    this.db
      .prepare("INSERT INTO events(runId,type,code,at) VALUES(?,?,?,?)")
      .run(runId, type, code, Date.now());
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  dispatch(d: Dispatch, persist?: (run: Run) => void): Run {
    return this.transaction(() => {
      const dup = this.db
        .prepare("SELECT * FROM runs WHERE requestId=?")
        .get(d.requestId) as Run | undefined;
      if (dup) return dup;
      const now = Date.now();
      const matterId = d.matterId ?? `matter-${randomUUID()}`;
      if (d.matterId) {
        if (!this.matters().find((m) => m.id === matterId))
          throw new Error("matter_not_found");
        if (
          this.runs().some(
            (r) =>
              r.matterId === matterId &&
              ["queued", "running", "awaiting_review"].includes(r.status),
          )
        )
          throw new Error("matter_busy");
      } else
        this.db
          .prepare("INSERT INTO matters(id,title,status,createdAt) VALUES(?,?,?,?)")
          .run(matterId, d.title, "queued", now);
      const id = `run-${randomUUID()}`;
      this.db
        .prepare(
          "INSERT INTO runs(id,matterId,requestId,sourceRequestId,goal,material,status,createdAt) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(id, matterId, d.requestId, d.sourceRequestId ?? null, d.goal, d.material, "queued", now);
      this.db
        .prepare("UPDATE matters SET status=? WHERE id=?")
        .run("queued", matterId);
      this.event(id, "queued");
      const run = this.run(id)!;
      const result: unknown = persist?.(run);
      if (result && typeof (result as PromiseLike<unknown>).then === "function")
        throw new Error("dispatch_hook_must_be_synchronous");
      return run;
    });
  }
  runsForRequest(requestId: string): Run[] {
    return this.db.prepare(
      "SELECT * FROM runs WHERE sourceRequestId=? OR (sourceRequestId IS NULL AND requestId=?) ORDER BY createdAt,rowid",
    ).all(requestId, requestId) as Run[];
  }
  claim(): Run | undefined {
    return this.transaction(() => {
      const next = this.runs().find((r) => r.status === "queued");
      if (!next) return undefined;
      this.db
        .prepare("UPDATE runs SET status=?,startedAt=? WHERE id=?")
        .run("running", Date.now(), next.id);
      this.db
        .prepare("UPDATE matters SET status=? WHERE id=?")
        .run("running", next.matterId);
      this.event(next.id, "claimed");
      return this.run(next.id);
    });
  }
  engine(
    id: string,
    fields: { threadId?: string; turnId?: string; pid?: number },
  ) {
    for (const [k, v] of Object.entries(fields))
      this.db
        .prepare(`UPDATE runs SET ${k}=? WHERE id=? AND status='running'`)
        .run(v, id);
  }
  usage(id: string, value: unknown) {
    this.db
      .prepare("UPDATE runs SET usage=? WHERE id=?")
      .run(JSON.stringify(value), id);
  }
  awaitingReview(id: string, artifact: string) {
    if (this.run(id)?.status !== "running") return false;
    this.db
      .prepare("UPDATE runs SET status='awaiting_review',artifact=? WHERE id=?")
      .run(artifact, id);
    this.db
      .prepare("UPDATE matters SET status='awaiting_review' WHERE id=?")
      .run(this.run(id)!.matterId);
    this.event(id, "engine_completed");
    return true;
  }
  finish(
    id: string,
    status: Extract<
      Status,
      "succeeded" | "failed" | "cancelled" | "interrupted"
    >,
    code: string | null = null,
    summary: string | null = null,
  ): boolean {
    return this.transaction(() => {
      const r = this.run(id);
      if (!r || !["queued", "running", "awaiting_review"].includes(r.status))
        return false;
      this.db
        .prepare(
          "UPDATE runs SET status=?,errorCode=?,summary=?,endedAt=? WHERE id=?",
        )
        .run(status, code, summary, Date.now(), id);
      this.db
        .prepare("UPDATE matters SET status=? WHERE id=?")
        .run(status, r.matterId);
      this.event(id, "finished", code ?? status);
      return true;
    });
  }
  requestStop(id: string, reason = "user"): Run {
    const r = this.run(id);
    if (!r) throw new Error("run_not_found");
    if (
      ["queued", "running", "awaiting_review"].includes(r.status) &&
      !r.stopRequestedAt
    ) {
      this.db
        .prepare("UPDATE runs SET stopRequestedAt=?,stopReason=? WHERE id=?")
        .run(Date.now(), reason, id);
      this.event(id, "stop_requested", reason);
    }
    return this.run(id)!;
  }
  reconcile() {
    for (const r of this.runs()) {
      if (["queued", "running", "awaiting_review"].includes(r.status))
        this.finish(r.id, "interrupted", "restart_unconfirmed");
    }
    this.db
      .prepare(
        "UPDATE requests SET state='interrupted' WHERE state='processing'",
      )
      .run();
  }
  pendingDeliveries(): Run[] {
    return this.runs().filter(
      (r) =>
        r.delivery === "pending" &&
        ["succeeded", "failed", "cancelled", "interrupted"].includes(r.status),
    );
  }
  markDelivered(id: string) {
    if (
      this.db
        .prepare(
          "UPDATE runs SET delivery='delivered' WHERE id=? AND delivery='pending' AND status IN ('succeeded','failed','cancelled','interrupted')",
        )
        .run(id).changes
    )
      this.event(id, "delivered");
  }
  request(id: string) {
    return this.db.prepare("SELECT * FROM requests WHERE id=?").get(id) as
      | { id: string; hash: string; state: string; response: string | null }
      | undefined;
  }
  startRequest(id: string, hash: string) {
    this.db
      .prepare("INSERT INTO requests VALUES(?,?,'processing',NULL,?)")
      .run(id, hash, Date.now());
  }
  finishRequest(id: string, response: string) {
    this.db
      .prepare("UPDATE requests SET state='completed',response=? WHERE id=?")
      .run(response, id);
  }
}
