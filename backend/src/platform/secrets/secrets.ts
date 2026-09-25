import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigError } from "../errors.js";

/**
 * ADR-0030: game-server tokens are encrypted at rest with AES-256-GCM. A sealed value is
 * `nonce (12 random bytes) || ciphertext || auth tag (16 bytes)`, stored in a bytea column next to
 * the id of the key that sealed it, so the key can be rotated while old rows stay readable.
 *
 * Nothing here ever puts a key, a plaintext or a ciphertext into an error message or a log line.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** A random 32-byte key has about 30 distinct byte values; this only screens out obvious
 *  placeholders ("AAAA...", all zeros, a repeated short pattern), not weak entropy in general. */
const MIN_DISTINCT_BYTES = 12;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_KEY_ID = "k1";
const MAX_PLAINTEXT_BYTES = 8 * 1024;

/** Opening a stored value failed: an unknown key id, a wrong key, or a modified value. The
 *  message never says which, and never carries the value. */
export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

export interface SealedSecret {
  keyId: string;
  /** nonce || ciphertext || tag. */
  data: Buffer;
}

export interface SecretsKeyring {
  /** The id `seal` stamps on new values. */
  currentKeyId: string;
  /** Encrypts with the current key. `context` is REQUIRED and bound as authenticated data (e.g. `${serverId}:api`),
   *  so a sealed value copied to another row or field fails to open. */
  seal(plaintext: string, context: string): SealedSecret;
  /** Decrypts a value sealed by any key in the ring. Throws SecretsError on any failure. */
  open(keyId: string, data: Buffer, context: string): string;
  /** True when the ring can open values sealed with this key id. */
  hasKey(keyId: string): boolean;
}

/** Parses a strict base64 32-byte key; the error names the variable, never the value. */
function parseKey(variable: string, value: string): Buffer {
  const trimmed = value.trim();
  const key = Buffer.from(trimmed, "base64");
  // Round-trip so stray characters (which Buffer.from silently skips) are rejected.
  const canonical = key.toString("base64");
  const unpadded = trimmed.replace(/=+$/, "");
  const valid = key.length === KEY_BYTES && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && (canonical === trimmed || canonical.replace(/=+$/, "") === unpadded);
  if (!valid) {
    throw new ConfigError(`${variable} must be 32 random bytes encoded as base64 (e.g. \`openssl rand -base64 32\`).`);
  }
  if (new Set(key).size < MIN_DISTINCT_BYTES) {
    throw new ConfigError(`${variable} looks like a placeholder, not 32 random bytes (e.g. \`openssl rand -base64 32\`).`);
  }
  return key;
}

function parseKeyId(variable: string, value: string): string {
  if (!KEY_ID_PATTERN.test(value)) {
    throw new ConfigError(`${variable} must be 1-32 characters: letters, digits, "_" or "-".`);
  }
  return value;
}

/** The context is required (never empty), so a caller cannot forget to bind a value to its row. */
function requireContext(context: string): string {
  if (typeof context !== "string" || context.length === 0) {
    throw new SecretsError("A secret needs a non-empty context.");
  }
  return context;
}

/** Builds a keyring from a current key and any number of previous keys (kept only to read old rows). */
export function createSecretsKeyring(currentKeyId: string, keys: ReadonlyMap<string, Buffer>): SecretsKeyring {
  const current = keys.get(currentKeyId);
  if (!current) {
    throw new ConfigError("The current secrets key is missing from the keyring.");
  }
  const ring = new Map(keys);
  return {
    currentKeyId,
    seal(plaintext, context) {
      const bytes = Buffer.from(plaintext, "utf8");
      if (bytes.length === 0 || bytes.length > MAX_PLAINTEXT_BYTES) {
        throw new SecretsError(`A secret must be 1-${MAX_PLAINTEXT_BYTES} bytes.`);
      }
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", current, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(requireContext(context), "utf8"));
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return { keyId: currentKeyId, data: Buffer.concat([nonce, encrypted, cipher.getAuthTag()]) };
    },
    open(keyId, data, context) {
      const key = ring.get(keyId);
      if (!key || data.length < NONCE_BYTES + TAG_BYTES + 1) {
        throw new SecretsError("Could not decrypt a stored secret.");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, NONCE_BYTES), {
          authTagLength: TAG_BYTES,
        });
        decipher.setAAD(Buffer.from(requireContext(context), "utf8"));
        decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
        const plain = Buffer.concat([
          decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)),
          decipher.final(),
        ]);
        return plain.toString("utf8");
      } catch {
        // The crypto error text is deliberately dropped.
        throw new SecretsError("Could not decrypt a stored secret.");
      }
    },
    hasKey: (keyId) => ring.has(keyId),
  };
}

/**
 * Reads the keyring from the environment, validated at startup:
 * - `SERVER_SECRETS_KEY`: the current key, 32 bytes as base64. Unset means the feature is off
 *   (returns null); set but malformed refuses to start.
 * - `SERVER_SECRETS_KEY_ID`: the id stored with values it seals (default `k1`).
 * - `SERVER_SECRETS_PREVIOUS_KEYS`: optional `id=base64,id2=base64` for keys retired by a rotation,
 *   kept so old rows stay readable until they are re-sealed.
 */
export function loadSecretsKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): SecretsKeyring | null {
  const raw = env.SERVER_SECRETS_KEY;
  if (raw === undefined || raw.trim() === "") {
    if (env.SERVER_SECRETS_KEY_ID?.trim() || env.SERVER_SECRETS_PREVIOUS_KEYS?.trim()) {
      throw new ConfigError("SERVER_SECRETS_KEY_ID and SERVER_SECRETS_PREVIOUS_KEYS need SERVER_SECRETS_KEY.");
    }
    return null;
  }
  const currentKeyId = parseKeyId("SERVER_SECRETS_KEY_ID", env.SERVER_SECRETS_KEY_ID?.trim() || DEFAULT_KEY_ID);
  const keys = new Map<string, Buffer>([[currentKeyId, parseKey("SERVER_SECRETS_KEY", raw)]]);
  const previous = env.SERVER_SECRETS_PREVIOUS_KEYS?.trim();
  if (previous) {
    for (const entry of previous.split(",")) {
      const separator = entry.indexOf("=");
      if (separator < 0) {
        throw new ConfigError("SERVER_SECRETS_PREVIOUS_KEYS entries must look like `id=base64key`.");
      }
      const id = parseKeyId("SERVER_SECRETS_PREVIOUS_KEYS", entry.slice(0, separator).trim());
      if (keys.has(id)) {
        throw new ConfigError("SERVER_SECRETS_PREVIOUS_KEYS repeats a key id (or reuses the current one).");
      }
      keys.set(id, parseKey("SERVER_SECRETS_PREVIOUS_KEYS", entry.slice(separator + 1)));
    }
  }
  return createSecretsKeyring(currentKeyId, keys);
}
