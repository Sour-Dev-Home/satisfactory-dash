/**
 * #526 (security review L2): a runtime entry added AFTER a commit (the agent attach after a self-serve create, an enrolment
 * or a first snapshot) can race a removal (the owner's remove, the C4 sweep, the operator's remove) and put back the entry
 * of a server that is already deleted. Every post-commit add therefore goes through this: add, then re-read the server, and
 * remove the entry again if it is gone.
 *
 * Why that closes the race (one process, runtime changes in order): every removal drops the runtime entry AFTER its commit.
 * If the removal committed before the re-read here, the re-read sees it and this removes the entry. If it commits after
 * the re-read, its own post-commit remove runs after this add and removes the entry. Either way none is left.
 */
export interface GuardedRuntime {
  remove(publicId: string): Promise<unknown>;
}

export async function addUnlessRemoved(options: {
  publicId: string;
  runtime: GuardedRuntime;
  /** Adds (or replaces) the runtime entry. */
  add: () => Promise<unknown>;
  /** True while the server is live in the database (not removed). */
  isLive: (publicId: string) => Promise<boolean>;
}): Promise<boolean> {
  await options.add();
  if (await options.isLive(options.publicId)) return true;
  await options.runtime.remove(options.publicId);
  return false;
}
