import type { TelegramHostEvent, TelegramOrigin } from "./telegram-contract.js";
import { renderTelegramRich, splitTelegramText } from "./telegram-render.js";
import type { TelegramStore } from "./telegram-store.js";

export function queueTelegramText(store: TelegramStore, id: string, origin: TelegramOrigin, text: string, mode: "rich" | "plain", now: number, degraded: () => void = () => {}) {
  if (mode === "rich") {
    const result = renderTelegramRich(text);
    if (result.degraded) degraded();
    result.messages.forEach((message, index) => store.enqueue(`${id}:${index}`, origin, "rich", { rich_message: message }, now, id));
  } else splitTelegramText(text).forEach((part, index) => store.enqueue(`${id}:${index}`, origin, "text", { text: part }, now, id));
}

// Persist host output even while Telegram is intentionally disconnected. The
// binding must still match; only transport checks the separate enabled intent.
export function recordTelegramOutput(store: TelegramStore, event: TelegramHostEvent, now: number, degraded: () => void = () => {}) {
  if (event.type === "delta") return;
  if (event.type === "start") {
    if (event.generation.visibility !== "main_user") return;
    const origin = store.route(event.generation.sourceRequestId);
    if (origin && store.matches(origin)) store.createDraft(event.generation, origin, event.mode ?? "rich");
    return;
  }
  if (event.type === "finish") {
    const draft = store.draft(event.generationId);
    if (!draft || draft.state === "closed") return;
    const origin = JSON.parse(draft.origin) as TelegramOrigin;
    let text = event.text.trim() ? event.text : "本次回复未完成，请在主对话查看状态。";
    if (event.status === "interrupted") text = (event.text.trim() ? event.text + "\n\n" : "") + "已停止本次主回复。后台任务保持原状态。";
    else if (draft.state === "stop_requested" && event.status === "completed") text += "\n\n本次回复已经完成，停止未赶上。后台任务保持原状态。";
    store.atomic(() => {
      if (store.matches(origin)) queueTelegramText(store, "generation:" + event.generationId, origin, text, draft.mode, now, degraded);
      store.closeDraft(event.generationId);
    });
    return;
  }
  const origin = store.route(event.sourceRequestId);
  if (!origin || !store.matches(origin)) return;
  store.atomic(() => {
    if (event.type === "delivery") {
      queueTelegramText(store, "delivery:" + event.id, origin, event.text, "rich", now, degraded);
      if (event.resultId) store.enqueue("artifact:" + event.id, origin, "file", { resultId: event.resultId }, now, "delivery:" + event.id);
    } else {
      const buttons = store.interaction(event.id, origin, event.runId, Math.min(event.expiresAt, now + 1_800_000), event.options);
      if (buttons) {
        const parts = splitTelegramText(event.text);
        const group = "interaction:" + event.id;
        parts.slice(0, -1).forEach((text, index) => store.enqueue(`${group}:context:${index}`, origin, "text", { text }, now, group));
        store.enqueue(group, origin, "interaction", { interactionId: event.id, text: parts.at(-1) ?? "请回复此卡片补充信息。",
          ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map(button => [button]) } } : {}) }, now, group);
      }
    }
  });
}
