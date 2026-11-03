// Presentation only: the caller supplies the already projected conversation.
type DatedConversationMessage = {
  id: string; role: string; status?: string; text: string; createdAt?: unknown;
  process?: { sourceKind: string };
};

// Shared with the assistant wrapper: runtime placeholders have no persisted owner.
export function isVisibleConversationMessage(message: Pick<DatedConversationMessage, 'id' | 'role' | 'status' | 'text'> | undefined) {
  return !!message?.id && !(message.role === 'assistant' &&
    ['queued', 'cancelled'].includes(message.status ?? '') && !message.text);
}

export type MessageTimestamp = { dayKey: string; dayLabel?: string; dateTime: string; time: string; title: string };

function realDate(value: unknown): Date | undefined {
  if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string') return;
  if (typeof value === 'string' && !value.trim()) return;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function conversationTimestamps(messages: readonly DatedConversationMessage[], { now = new Date(), timeZone }: { now?: Date; timeZone?: string } = {}) {
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const clock = new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit' });
  const full = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  function day(date: Date) {
    const parts = calendar.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
    return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  }
  const today = day(now);
  // Subtract a calendar day, not 24 hours (DST days can be 23 or 25 hours).
  const previous = new Date(today + 'T12:00:00Z');
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const result = new Map<string, MessageTimestamp>();
  let precedingDay: string | undefined;
  for (const message of messages) {
    if (!isVisibleConversationMessage(message) || !['user', 'assistant'].includes(message.role) || message.process?.sourceKind === 'worker') continue;
    const date = realDate(message.createdAt);
    if (!date) continue; // Unknown time never creates a date segment or a fallback time.
    const dayKey = day(date);
    const [year, month, dateOfMonth] = dayKey.split('-');
    const label = dayKey === today ? '今天' : dayKey === yesterday ? '昨天' : `${year}年${Number(month)}月${Number(dateOfMonth)}日`;
    result.set(message.id, { dayKey, ...(dayKey !== precedingDay ? { dayLabel: label } : {}), dateTime: date.toISOString(), time: clock.format(date), title: full.format(date) });
    precedingDay = dayKey;
  }
  return result;
}
