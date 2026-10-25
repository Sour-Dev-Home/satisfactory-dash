/**
 * What other programs on the same PC may use of the agent (ADR-0040): the server manager reads the game's API token
 * through the agent's own DPAPI store, so the token stays where the agent keeps it. Exports only, no behaviour: the
 * agent itself runs from `main.ts`.
 */
export { AgentStore, DEFAULT_GAME, resolveDataDir, StoreError } from "./store.js";
export type { SecretName, StoreFile } from "./store.js";
export { createDpapi, DpapiError } from "./dpapi.js";
export { createSecretBox, fileSecretBox, FileSecretBoxError, resolveSecretStoreKind } from "./secretbox.js";
export type { SecretBox, SecretStoreKind } from "./secretbox.js";
