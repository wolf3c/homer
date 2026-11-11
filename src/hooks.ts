type Handler<Payload> = (payload: Payload) => void | Promise<void>;
type Registration = { enqueue: (payload: unknown) => void; cancel: () => void };

export function createHooks<Events extends object>(
  events: readonly (keyof Events)[],
  report: (event: keyof Events, listenerId: number) => void,
) {
  const listeners = new Map(events.map(event => [event, new Set<Registration>()]));
  let nextId = 0;
  let closed = false;

  function on<Event extends keyof Events>(event: Event, handler: Handler<Events[Event]>) {
    const group = listeners.get(event);
    if (closed || !group) throw Error('hook_unavailable');
    const id = ++nextId;
    let busy = false;
    let pending: { payload: Events[Event] } | undefined;

    function schedule() {
      busy = true;
      setImmediate(async () => {
        if (!group!.has(registration) || !pending) return;
        const { payload } = pending;
        pending = undefined;
        try {
          await handler(payload);
        } catch {
          if (!closed) {
            try { report(event, id); } catch { /* Diagnostics must not affect dispatch. */ }
          }
        } finally {
          busy = false;
          if (group!.has(registration) && pending) schedule();
          else pending = undefined;
        }
      });
    }

    function enqueue(payload: unknown) {
      pending = { payload: payload as Events[Event] };
      if (!busy) schedule();
    }

    const registration = {
      enqueue,
      cancel() {
        pending = undefined;
        group!.delete(registration);
      },
    };
    group.add(registration);
    return registration.cancel;
  }

  return {
    listener: { on },
    emit<Event extends keyof Events>(event: Event, payload: Events[Event]) {
      for (const registration of listeners.get(event) ?? []) registration.enqueue(payload);
    },
    close() {
      closed = true;
      for (const group of listeners.values()) for (const registration of group) registration.cancel();
    },
  };
}
