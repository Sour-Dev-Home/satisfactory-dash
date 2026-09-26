/**
 * A tiny in-process mutex: `run` executes callbacks one at a time, in call order. A callback that
 * throws releases the lock for the next one and its error reaches only its own caller. In-process
 * on purpose (one backend instance, ADR-0010); a cross-process guarantee needs a database lock.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
