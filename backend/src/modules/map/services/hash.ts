import { createHash } from "node:crypto";

/** A stable digest of a world layer's (or mapLive's) surviving, projected data — content-addressing
 *  for dedup ("an unchanged hash writes nothing"), not a security boundary, so sha256 vs. a faster
 *  hash doesn't matter; sha256 is already an import elsewhere in the backend (agents' clientKey.ts).
 *  `JSON.stringify` is deterministic here because every producer (the game-adapter mappers, this
 *  module's own per-item re-validation) builds its output objects with the SAME key order every
 *  time — never a value serialized from a Map/Set or built by spreading in varying order. */
export function contentHash(data: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
