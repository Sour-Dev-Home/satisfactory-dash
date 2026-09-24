/**
 * Login return paths (ADR-0025 decision 3) that the ASCII allowlist must accept or refuse. Shared
 * by the zod-schema unit test and the real-Postgres CHECK-constraint test, so the application and
 * the database are held to exactly the same cases.
 */
export const RETURN_PATH_ACCEPTED = [
  "/app",
  "/app/",
  "/app/servers",
  "/app/servers/abc",
  "/app/servers/abc?tab=power#x",
  "/app?tab=power",
  "/app#section",
  "/app/a/b?c=d&e=f",
  "/app/caf%C3%A9",
  "/app/a.b_c~d",
  "/app/items(1)",
  "/app?next=/app/x?y",
  "/app/x:y@z",
];

export const RETURN_PATH_REJECTED: [label: string, path: string][] = [
  ["a protocol-relative URL", "//evil.example"],
  ["a protocol-relative URL after /app", "/app//../evil"],
  ["an absolute URL", "https://evil.example/app"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["a look-alike prefix (/appx)", "/appx"],
  ["a look-alike prefix (/application)", "/application"],
  ["a path outside /app", "/other"],
  ["a relative path", "app/servers"],
  ["an empty string", ""],
  ["a dot segment", "/app/../x"],
  ["a dot segment at the end", "/app/.."],
  ["a backslash", "/app\\evil"],
  ["a leading backslash", "\\\\evil"],
  ["a space", "/app/a b"],
  ["a tab", "/app/a\tb"],
  ["a line feed", "/app/a\nb"],
  ["a carriage return", "/app/a\rb"],
  ["a trailing newline", "/app\n"],
  ["U+2028 LINE SEPARATOR", "/app/a b"],
  ["U+2029 PARAGRAPH SEPARATOR", "/app/a b"],
  ["U+0085 NEXT LINE", "/app/a\u0085b"],
  ["a non-ASCII letter", "/app/café"],
  ["a fullwidth solidus", "/app／evil"],
  ["a double quote", '/app/"x'],
  ["an angle bracket", "/app/<x>"],
  ["a pipe", "/app/a|b"],
  ["a caret", "/app/a^b"],
  ["a backtick", "/app/a`b"],
  ["a curly brace", "/app/{x}"],
  ["a second fragment", "/app#a#b"],
];

/** Postgres text cannot hold a NUL at all (the driver refuses it before any CHECK runs), so this
 *  case is only in the schema-level (zod) test. */
export const RETURN_PATH_REJECTED_BY_ZOD_ONLY: [label: string, path: string][] = [["a NUL", "/app/a\u0000b"]];
