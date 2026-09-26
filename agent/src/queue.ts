/**
 * A bounded queue that DROPS THE OLDEST when full (ADR-0031 PR 6). While the backend is unreachable the agent keeps
 * sampling; a dashboard wants the newest readings, and an unbounded queue would grow without limit on a PC that is left
 * running for weeks. `push` reports how many it dropped, so the caller can log a count (never the contents).
 */
export class BoundedQueue<T> {
  private items: T[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError("a queue holds at least one item");
  }

  /** Adds an item; returns how many old items were dropped to make room (0 or 1). */
  push(item: T): number {
    this.items.push(item);
    if (this.items.length <= this.max) return 0;
    const dropped = this.items.length - this.max;
    this.items = this.items.slice(dropped);
    return dropped;
  }

  /** The oldest item without removing it. */
  peek(): T | undefined {
    return this.items[0];
  }

  /** Removes and returns the oldest item. */
  shift(): T | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }
}
