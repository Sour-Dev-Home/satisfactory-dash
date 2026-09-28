// oxlint JS plugin (#368): bans the two lookup shapes that let an untrusted key reach Object.prototype. #361 (the
// metric registry) and #367 (mapNodeType) both checked a closed set with a plain lookup, so `toString` or `__proto__`
// passed as a known name. Use Object.hasOwn, `ownValue` from @satisfactory-dash/shared, or a Map.
//
// oxlint has no `no-restricted-syntax`, so the rules are ESLint-style selectors in a local plugin, loaded through each
// package's .oxlintrc.json (`jsPlugins`). That API is alpha in oxlint: scripts/lint/safe-lookup.test.mjs runs the real
// oxlint on known-bad and known-good code, and fails loudly if a version bump stops the plugin from reporting.
//
// A disable comment is only for a key that is a literal-typed constant which can never come from data:
//   // oxlint-disable-next-line safe-lookup/no-table-index -- <why the key can't be untrusted>

/** An ALL_CAPS identifier: this repo's naming for lookup tables (METRIC_REGISTRY, KNOWN_NODE_TYPES, ...). */
const TABLE_NAME = /^[A-Z][A-Z0-9_]+$/;

/** Wrappers that don't change which value is read: `T[k]!`, `(T[k])`, `T[k] as X`. */
const TRANSPARENT = new Set(["TSNonNullExpression", "ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression"]);

/**
 * True for the form the message recommends: `Object.hasOwn(T, k) ? T[k] : fallback`, where the lookup is (possibly
 * wrapped) the ternary's consequent and the guard names the same table and the same key, compared as source text.
 */
function guardedByHasOwn(node, sourceCode) {
  let child = node;
  let parent = node.parent;
  while (parent && TRANSPARENT.has(parent.type)) {
    child = parent;
    parent = parent.parent;
  }
  if (parent?.type !== "ConditionalExpression" || parent.consequent !== child) return false;
  const test = parent.test;
  const isHasOwn =
    test?.type === "CallExpression" &&
    test.callee.type === "MemberExpression" &&
    !test.callee.computed &&
    test.callee.object.type === "Identifier" &&
    test.callee.object.name === "Object" &&
    test.callee.property.name === "hasOwn" &&
    test.arguments.length === 2;
  if (!isHasOwn) return false;
  const [table, key] = test.arguments;
  return table.type === "Identifier" && table.name === node.object.name && sourceCode.getText(key) === sourceCode.getText(node.property);
}

export default {
  meta: { name: "safe-lookup" },
  rules: {
    // A literal left side (`"route" in value`) is allowed: the key is written in the code, not taken from data, and it's
    // TypeScript's narrowing idiom (Object.hasOwn doesn't narrow). Rule 2 exempts a Literal property the same way.
    // By design that includes a literal prototype name (`"constructor" in obj` is not flagged): it's a reviewed
    // constant in the code, and the fixture test pins this choice.
    "no-in-operator": {
      meta: { type: "problem", docs: { description: "`key in obj` is true for inherited names like toString." } },
      create(context) {
        return {
          "BinaryExpression[operator='in'][left.type!='Literal']"(node) {
            context.report({ node, message: "use Object.hasOwn(obj, key), or a Map" });
          },
        };
      },
    },
    "no-table-index": {
      meta: { type: "problem", docs: { description: "TABLE[variable] returns inherited members for names like toString." } },
      create(context) {
        return {
          "MemberExpression[computed=true][object.type='Identifier'][property.type!='Literal']"(node) {
            if (TABLE_NAME.test(node.object.name) && !guardedByHasOwn(node, context.sourceCode)) {
              context.report({
                node,
                message: "lookup tables indexed by a variable: use Object.hasOwn(...) ? T[k] : fallback, or a Map",
              });
            }
          },
        };
      },
    },
  },
};
