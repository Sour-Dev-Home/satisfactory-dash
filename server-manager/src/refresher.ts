/**
 * One read at a time. A plain refresh while a read runs joins it (the 3 s poll never stacks a slow PowerShell). A fresh
 * refresh, after Start, Stop or Resume, needs a read that began after the action: while one runs, it waits for that
 * read and then reads again, and every fresh request made meanwhile shares that one follow-up read.
 */
export function createRefresher(read: () => Promise<void>): (fresh?: boolean) => Promise<void> {
  let current: Promise<void> | undefined;
  let next: Promise<void> | undefined;

  const start = (): Promise<void> => {
    const p = read().finally(() => {
      if (current === p) current = undefined;
    });
    current = p;
    return p;
  };

  return (fresh = false) => {
    if (current === undefined) return start();
    if (!fresh) return current;
    next ??= current
      .catch(() => undefined)
      .then(() => {
        next = undefined;
        return current ?? start();
      });
    return next;
  };
}
