import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ConversationHistory } from "../src/web-history.js";

// Source: requirement-derived contract, synthetic content only.
test("web history accepts input atomically and survives a new history owner", () => {
  const db = new DatabaseSync(":memory:");
  const history = new ConversationHistory(db);
  const accepted = history.accept("thread-a", { requestId: "request-a", text: "合成问题" });
  assert.equal(accepted.fresh, true);
  history.append(accepted.replyId, "合成");
  assert.equal(new ConversationHistory(db).list("thread-a")[1]?.text, "合成");
  history.finish(accepted.replyId, "合成回答", "completed");
  assert.equal(history.accept("thread-a", { requestId: "request-a", text: "合成问题" }).fresh, false);
  assert.equal(history.list("thread-a").length, 2);
  assert.throws(() => history.accept("thread-a", { requestId: "request-a", text: "另一问题" }), /request_id_conflict/);
  db.close();
});

test("quote is tied to a persisted message and exact source substring", () => {
  const db = new DatabaseSync(":memory:");
  const history = new ConversationHistory(db);
  const first = history.accept("thread-a", { requestId: "first", text: "问题" });
  history.finish(first.replyId, "一段准确的合成回答", "completed");
  const quote = { messageId: first.replyId, text: "准确的合成" };
  history.accept("thread-a", { requestId: "second", text: "补充要求", quote });
  assert.deepEqual(history.list("thread-a")[2]?.quote, quote);
  assert.throws(() => history.accept("thread-a", { requestId: "bad", text: "补充", quote: { ...quote, text: "伪造" } }), /quote_source_mismatch/);
  assert.throws(() => history.accept("thread-b", { requestId: "other", text: "补充", quote }), /quote_source_mismatch/);
  assert.equal(history.list("thread-a").length, 4);
  assert.equal(history.list("thread-b").length, 0);
  db.close();
});

test("reconcile retains partial replies without replaying accepted inputs", () => {
  const db = new DatabaseSync(":memory:");
  const history = new ConversationHistory(db);
  const first = history.accept("thread-a", { requestId: "first", text: "合成输入" });
  history.append(first.replyId, "已收到的部分");
  history.reconcile();
  assert.equal(history.list("thread-a")[1]?.status, "interrupted");
  assert.equal(history.list("thread-a")[1]?.text, "已收到的部分");
  assert.equal(history.accept("thread-a", { requestId: "first", text: "合成输入" }).fresh, false);
  db.close();
});

test("quotes match visible Markdown in the exact source message, including formatting, links, tables and line breaks", () => {
  const db = new DatabaseSync(":memory:"), history = new ConversationHistory(db);
  const first = history.accept("thread-a", { requestId: "markdown-source", text: "合成来源" });
  history.finish(first.replyId, "先**核对材料**，再[交付成果](https://example.com)。\n\n| 事项 | 状态 |\n| --- | --- |\n| 阅读材料 | 已完成 |\n\n保留第一行\n再补第二行", "completed");
  const selections = ["先核对材料，再交付成果。", "核对材料，再交付成果", "事项\t状态\n阅读材料\t已完成", "保留第一行 再补第二行"];
  for (const [i, text] of selections.entries()) {
    history.accept("thread-a", { requestId: "markdown-quote-" + i, text: "合成补充", quote: { messageId: first.replyId, text } });
    assert.equal(history.list("thread-a").at(-2)?.quote?.text, text);
  }
  assert.throws(() => history.accept("thread-a", { requestId: "hidden-destination", text: "补充", quote: { messageId: first.replyId, text: "https://example.com" } }), /quote_source_mismatch/);
  assert.throws(() => history.accept("thread-a", { requestId: "forged-visible", text: "补充", quote: { messageId: first.replyId, text: "先删除材料，再交付成果。" } }), /quote_source_mismatch/);
  const second = history.accept("thread-a", { requestId: "other-message", text: "另一来源" });
  history.finish(second.replyId, "只交付成果，不包含核对材料。", "completed");
  assert.throws(() => history.accept("thread-a", { requestId: "wrong-message", text: "补充", quote: { messageId: second.replyId, text: selections[0]! } }), /quote_source_mismatch/);
  assert.throws(() => history.accept("thread-b", { requestId: "wrong-thread", text: "补充", quote: { messageId: first.replyId, text: selections[0]! } }), /quote_source_mismatch/);
  db.close();
});
