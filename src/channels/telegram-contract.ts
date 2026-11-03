// Channel boundary only. The single Homer host owns history, model turns and workers.
export type TelegramOrigin = {
  channel: "telegram";
  botId: string;
  chatId: string;
  userId: string;
  bindingVersion: number;
  messageId: number;
};

export type MainGeneration = {
  id: string;
  messageId: string;
  threadId: string;
  turnId: string;
  sourceRequestId: string;
  visibility: "main_user";
};

export type TelegramHostEvent =
  | { type: "start"; generation: MainGeneration; mode?: "rich" | "plain" }
  | { type: "delta"; generationId: string; sequence: number; text: string }
  | { type: "finish"; generationId: string; text: string; status: "completed" | "interrupted" | "failed" }
  | { type: "delivery"; id: string; sourceRequestId: string; text: string; runId?: string }
  | { type: "interaction"; id: string; sourceRequestId: string; runId: string; text: string;
      kind: "question" | "authorization"; expiresAt: number; options: { id: string; label: string; text: string }[] };

export interface TelegramHost {
  // Resolve after durable, idempotent acceptance, not after the model finishes.
  // A reused requestId must not start a second turn; conflicts must fail closed.
  submit(input: { requestId: string; text: string; origin: TelegramOrigin }): Promise<void>;
  // An independent control path: compare every identity against the active turn.
  stop(generation: MainGeneration): Promise<"stopped" | "already_finished" | "unconfirmed">;
  // Must deduplicate requestId and validate pending/live original interaction.
  respond(input: { interactionId: string; requestId: string; text: string; origin: TelegramOrigin }): Promise<void>;
  // Content must come from the core's checked artifact, never a user supplied path.
  artifact(runId: string, origin?: TelegramOrigin): Promise<{ filename: string; bytes: Uint8Array }>;
}

export type TelegramChat = { id: number; type: string };
export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: { id: number; is_bot?: boolean };
  text?: string;
  message_thread_id?: number;
  reply_to_message?: { message_id: number };
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; is_bot?: boolean };
    message?: TelegramMessage;
    data?: string;
  };
  stopped_message_generation?: { chat: TelegramChat; message_thread_id?: number; draft_id: number };
};

export function telegramId(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("telegram_invalid_id");
  return String(value);
}
