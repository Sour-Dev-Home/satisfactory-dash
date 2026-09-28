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

/** Wrappers that don't change which value is read: `T[k]!`, `(T[k])`, `T[k] as X`, `T?.[k]`. */
const TRANSPARENT = new Set(["TSNonNullExpression", "ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "ChainExpression"]);

/**
 * The lookup table's name when `expr` is one, seen through the same wrappers (`(TABLE as X)`, `TABLE!`), or null.
 * Found by the fresh-eyes pass: a cast table hid both the index and the destructuring form.
 */
function tableName(expr) {
  let node = expr;
  while (node && TRANSPARENT.has(node.type)) node = node.expression;
  return node?.type === "Identifier" && TABLE_NAME.test(node.name) ? node.name : null;
}

/**
 * The table a destructuring pattern reads from: `const { [k]: v } = TABLE`, `({ [k]: v } = TABLE)`, or a parameter
 * default `({ [k]: v } = TABLE) => ...`.
 */
function destructuredFrom(pattern) {
  const parent = pattern.parent;
  if (parent?.type === "VariableDeclarator" && parent.id === pattern) return parent.init;
  if (parent?.type === "AssignmentExpression" && parent.left === pattern) return parent.right;
  if (parent?.type === "AssignmentPattern" && parent.left === pattern) return parent.right;
  return null;
}

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
  const name = tableName(table);
  return name !== null && name === tableName(node.object) && sourceCode.getText(key) === sourceCode.getText(node.property);
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
            context.report({ node, message: "use Object.hasOwn(obj, key), ownValue(table, key) from @satisfactory-dash/shared, or a Map" });
          },
        };
      },
    },
    "no-table-index": {
      meta: { type: "problem", docs: { description: "TABLE[variable] returns inherited members for names like toString." } },
      create(context) {
        return {
          "MemberExpression[computed=true][property.type!='Literal']"(node) {
            if (tableName(node.object) !== null && !guardedByHasOwn(node, context.sourceCode)) {
              context.report({
                node,
                message: "lookup tables indexed by a variable: use ownValue(TABLE, k) ?? fallback (@satisfactory-dash/shared), Object.hasOwn(TABLE, k) ? TABLE[k] : fallback, or a Map",
              });
            }
          },
          // The same read as a destructuring: `const { [k]: v } = TABLE` (found by the fresh-eyes pass).
          "ObjectPattern > Property[computed=true][key.type!='Literal']"(node) {
            if (tableName(destructuredFrom(node.parent)) !== null) {
              context.report({
                node,
                message: "lookup tables indexed by a variable: use ownValue(TABLE, k) ?? fallback (@satisfactory-dash/shared), Object.hasOwn(TABLE, k) ? TABLE[k] : fallback, or a Map",
              });
            }
          },
        };
      },
    },
  },
};
