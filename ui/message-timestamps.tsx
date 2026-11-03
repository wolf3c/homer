import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { conversationTimestamps, type MessageTimestamp as Timestamp } from './chat-date';
import './message-timestamps.css';

const TimestampContext = createContext<ReadonlyMap<string, Timestamp>>(new Map());

export function MessageTimestamps({ messages, children }: { messages: Parameters<typeof conversationTimestamps>[0]; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      const midnight = new Date(current);
      midnight.setHours(24, 0, 0, 50);
      timer = setTimeout(refresh, midnight.getTime() - current.getTime());
    };
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', resume); };
  }, []);
  const timestamps = useMemo(() => conversationTimestamps(messages, { now }), [messages, now]);
  return <TimestampContext.Provider value={timestamps}>{children}</TimestampContext.Provider>;
}

export function MessageDaySeparator({ messageId }: { messageId: string }) {
  const timestamp = useContext(TimestampContext).get(messageId);
  return timestamp?.dayLabel ? <div className="message-day-separator"><time dateTime={timestamp.dayKey}>{timestamp.dayLabel}</time></div> : null;
}

export function MessageTimestamp({ messageId }: { messageId: string }) {
  const timestamp = useContext(TimestampContext).get(messageId);
  return timestamp ? <time className="message-timestamp" tabIndex={0} dateTime={timestamp.dateTime} title={timestamp.title} aria-label={'消息时间：' + timestamp.title}>{timestamp.time}</time> : null;
}
