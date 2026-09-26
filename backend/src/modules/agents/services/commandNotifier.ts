/**
 * ADR-0031 PR 5b: wakes an agent's long-poll the moment a command is created for its server, instead of the agent
 * polling every few seconds. In process (one backend instance, ADR-0010): with a second instance this becomes a Postgres
 * LISTEN/NOTIFY or a short poll, and only this file changes.
 *
 * A long-poll SUBSCRIBES before it looks at the database, so a command created between "nothing there" and "start
 * waiting" still wakes it (no lost wake-up). Each server keeps at most `MAX_WAITERS_PER_SERVER` waiters: a new one beyond
 * that releases the OLDEST at once, so an agent that opens a poll on every retry cannot pile them up.
 */
export const MAX_WAITERS_PER_SERVER = 3;

export interface Subscription {
  /** Resolves when notified, when the time is up, when `signal` aborts, or when this waiter was evicted. Never rejects. */
  wake: Promise<void>;
  /** Stops waiting (the poll found something, or the client went away). Safe to call twice. */
  cancel(): void;
}

interface Waiter {
  release(): void;
}

export class CommandNotifier {
  private readonly waiters = new Map<string, Set<Waiter>>();

  subscribe(serverUuid: string, timeoutMs: number, signal?: AbortSignal): Subscription {
    let release!: () => void;
    const wake = new Promise<void>((resolve) => {
      release = resolve;
    });
    const set = this.waiters.get(serverUuid) ?? new Set<Waiter>();
    this.waiters.set(serverUuid, set);
    const waiter: Waiter = { release: () => cancel() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      set.delete(waiter);
      if (set.size === 0 && this.waiters.get(serverUuid) === set) this.waiters.delete(serverUuid);
      release();
    };
    // Evict the oldest waiters beyond the cap (a Set iterates in insertion order).
    while (set.size >= MAX_WAITERS_PER_SERVER) {
      const oldest = set.values().next().value as Waiter;
      oldest.release();
    }
    set.add(waiter);
    timer = setTimeout(cancel, Math.max(0, timeoutMs));
    timer.unref?.();
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    return { wake, cancel };
  }

  /** A command was created for this server: every long-poll waiting for it wakes. */
  notify(serverUuid: string): void {
    const set = this.waiters.get(serverUuid);
    if (set === undefined) return;
    for (const waiter of [...set]) waiter.release();
  }

  /** How many long-polls are waiting for this server (tests, and a leak check). */
  waiting(serverUuid: string): number {
    return this.waiters.get(serverUuid)?.size ?? 0;
  }
}
