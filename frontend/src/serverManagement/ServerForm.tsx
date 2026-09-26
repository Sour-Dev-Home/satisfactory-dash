import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreateServerRequestSchema,
  endpoints,
  RESERVED_SERVER_IDS,
  TestConnectionRequestSchema,
  UpdateServerRequestSchema,
  type ServerConnection,
  type TestConnectionResponse,
} from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { MANAGED_KEY, queries } from "../api/queries";
import { isNonLoopbackIpLiteral } from "./hosts";
import { ManagementError } from "./ManagementError";
import { LOOPBACK_ONLY } from "./messages";
import { TestResult } from "./TestResult";

/**
 * create: a new server. edit: any field; a blank token keeps the stored one. repair: the stored
 * tokens can't be read, so both are entered again. rename: only the name (works whatever the
 * tokens' state).
 */
export type FormMode =
  | { kind: "create" }
  | { kind: "edit" | "repair" | "rename"; server: ServerConnection };

type Field = "id" | "displayName" | "host" | "apiPort" | "frmPort" | "apiToken" | "frmToken";

const FIELD_ERROR: Record<Field, string> = {
  id: "Use 1 to 32 lowercase letters, digits or dashes.",
  displayName: "Enter a name of up to 64 characters.",
  host: "Enter a hostname or an IP address only (no scheme, port or path).",
  apiPort: "Enter a port from 1 to 65535.",
  frmPort: "Enter a port from 1 to 65535.",
  apiToken: "A token is printable characters without spaces.",
  frmToken: "A token is printable characters without spaces.",
};

const SHOWS: Record<FormMode["kind"], readonly Field[]> = {
  create: ["id", "displayName", "host", "apiPort", "frmPort", "apiToken", "frmToken"],
  edit: ["displayName", "host", "apiPort", "frmPort", "apiToken", "frmToken"],
  repair: ["apiToken", "frmToken"],
  rename: ["displayName"],
};

const TITLE: Record<FormMode["kind"], string> = {
  create: "Add a server",
  edit: "Edit server",
  repair: "Re-enter both tokens",
  rename: "Rename server",
};

type Values = Record<Field, string>;

function initialValues(mode: FormMode): Values {
  const server = mode.kind === "create" ? undefined : mode.server;
  return {
    id: "",
    displayName: server?.displayName ?? "",
    host: server?.host ?? "127.0.0.1",
    apiPort: String(server?.apiPort ?? 7777),
    frmPort: String(server?.frmPort ?? 8080),
    // Write-only: never prefilled (ADR-0030).
    apiToken: "",
    frmToken: "",
  };
}

const port = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

/** The request body for this mode, before validation. Undefined: nothing to change. */
function bodyFor(mode: FormMode, v: Values, clearFrm: boolean): Record<string, unknown> | undefined {
  if (mode.kind === "create") {
    return {
      id: v.id.trim(),
      displayName: v.displayName,
      host: v.host,
      apiPort: port(v.apiPort),
      frmPort: port(v.frmPort),
      apiToken: v.apiToken,
      ...(v.frmToken !== "" && { frmToken: v.frmToken }),
    };
  }
  const { server } = mode;
  if (mode.kind === "rename") return v.displayName.trim() === server.displayName ? undefined : { displayName: v.displayName };
  if (mode.kind === "repair") return { apiToken: v.apiToken, frmToken: v.frmToken === "" ? null : v.frmToken };
  const body: Record<string, unknown> = {};
  if (v.displayName.trim() !== server.displayName) body.displayName = v.displayName;
  if (v.host.trim() !== server.host) body.host = v.host;
  if (port(v.apiPort) !== server.apiPort) body.apiPort = port(v.apiPort);
  if (port(v.frmPort) !== server.frmPort) body.frmPort = port(v.frmPort);
  if (v.apiToken !== "") body.apiToken = v.apiToken;
  if (v.frmToken !== "") body.frmToken = v.frmToken;
  else if (clearFrm) body.frmToken = null;
  return Object.keys(body).length > 0 ? body : undefined;
}

type Issues = readonly { path: readonly PropertyKey[] }[];

function fieldErrors(issues: Issues, values: Values): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0] as Field;
    if (!(field in FIELD_ERROR) || errors[field]) continue;
    errors[field] =
      field === "id" && (RESERVED_SERVER_IDS as readonly string[]).includes(values.id.trim())
        ? "That id is reserved."
        : FIELD_ERROR[field];
  }
  return errors;
}

function tokenHint(set: boolean, last4: string | null): string {
  if (!set) return "Not set.";
  return last4 ? `Set, ends in ${last4}.` : "Set.";
}

export function ServerForm({ mode, onDone }: { mode: FormMode; onDone: (message: string) => void }) {
  const client = useQueryClient();
  const formId = useId();
  const [values, setValues] = useState<Values>(() => initialValues(mode));
  const [clearFrm, setClearFrm] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [nothingToChange, setNothingToChange] = useState(false);
  const [tested, setTested] = useState<TestConnectionResponse>();
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const shows = SHOWS[mode.kind];
  const server = mode.kind === "create" ? undefined : mode.server;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mode.kind === "create"
        ? apiSend(endpoints.serverManagement.create, body as never)
        : apiSend(endpoints.serverManagement.update, body as never, mode.server.id),
    onSuccess: async ({ server: saved }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: MANAGED_KEY }),
        client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
      ]);
      onDone(mode.kind === "create" ? `Added ${saved.displayName}.` : `Saved ${saved.displayName}.`);
    },
  });
  const test = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiSend(endpoints.serverManagement.testConnection, body as never),
    onSuccess: setTested,
  });

  const set = (field: Field) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setNothingToChange(false);
    setTested(undefined);
  };

  /** Validates with the shared schema; on failure marks the fields and focuses the first. */
  function validated(schema: { safeParse(input: unknown): { success: boolean; error?: { issues: Issues } } }, body: unknown) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return true;
    const found = fieldErrors(parsed.error?.issues ?? [], values);
    setErrors(found);
    const first = shows.find((field) => found[field]);
    if (first) inputs.current[first]?.focus();
    return false;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = bodyFor(mode, values, clearFrm);
    if (!body) {
      setNothingToChange(true);
      return;
    }
    const schema = mode.kind === "create" ? CreateServerRequestSchema : UpdateServerRequestSchema;
    if (validated(schema, body)) save.mutate(body);
  }

  function runTest() {
    const body = bodyFor({ kind: "create" }, values, false)!;
    const { id: _id, displayName: _name, ...connection } = body;
    if (validated(TestConnectionRequestSchema, connection)) test.mutate(connection);
  }

  const field = (name: Field, label: string, extra: { hint?: ReactNode; password?: boolean; numeric?: boolean } = {}) => {
    const errorId = `${formId}-${name}-error`;
    const hintId = `${formId}-${name}-hint`;
    const describedBy = [extra.hint && hintId, errors[name] && errorId].filter(Boolean).join(" ") || undefined;
    // The hint and error sit outside the <label>, so the field's name is only its label.
    return (
      <div key={name} className="grid content-start gap-1.5 text-sm">
        <label htmlFor={`${formId}-${name}`}>{label}</label>
        <input
          id={`${formId}-${name}`}
          ref={(el) => {
            inputs.current[name] = el;
          }}
          name={name}
          value={values[name]}
          onChange={(e) => set(name)(e.target.value)}
          type={extra.password ? "password" : "text"}
          inputMode={extra.numeric ? "numeric" : undefined}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={describedBy}
        />
        {extra.hint && (
          <span id={hintId} className="text-muted">
            {extra.hint}
          </span>
        )}
        {errors[name] && (
          <span id={errorId} className="text-fg-strong">
            {errors[name]}
          </span>
        )}
      </div>
    );
  };

  const busy = save.isPending || test.isPending;
  const keepsTokens = mode.kind === "edit";
  const saveError = save.error ?? test.error;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${formId}-title`}
      className="grid gap-4 rounded-card border border-line bg-surface p-5"
    >
      <h3 id={`${formId}-title`} className="mb-0">
        {TITLE[mode.kind]}
        {server && <span className="font-normal text-muted">: {server.displayName}</span>}
      </h3>
      {mode.kind === "repair" && (
        <p className="mb-0 text-sm text-muted">
          The saved tokens can't be read by this backend (its key changed). Enter both again; leave the FRM token
          blank if FRM runs without one.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {shows.includes("id") &&
          field("id", "Server id", { hint: "Used in links. Lowercase letters, digits and dashes; can't be changed." })}
        {shows.includes("displayName") && field("displayName", "Name")}
        {shows.includes("host") &&
          field("host", "Host", {
            hint: isNonLoopbackIpLiteral(values.host) ? LOOPBACK_ONLY : "The game server's machine, e.g. 127.0.0.1.",
          })}
        {shows.includes("apiPort") && field("apiPort", "Game API port", { numeric: true })}
        {shows.includes("frmPort") && field("frmPort", "FRM port", { numeric: true })}
        {shows.includes("apiToken") &&
          field("apiToken", "Game API token", {
            password: true,
            hint: keepsTokens && server ? `${tokenHint(true, server.apiTokenLast4)} Leave blank to keep it.` : undefined,
          })}
        {shows.includes("frmToken") &&
          field("frmToken", "FRM token (optional)", {
            password: true,
            hint:
              keepsTokens && server
                ? `${tokenHint(server.frmTokenSet, server.frmTokenLast4)} Leave blank to keep it.`
                : "Leave blank if FRM runs without a token.",
          })}
      </div>
      {keepsTokens && server?.frmTokenSet && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearFrm}
            disabled={values.frmToken !== ""}
            onChange={(e) => {
              setClearFrm(e.target.checked);
              setNothingToChange(false);
            }}
          />
          Remove the FRM token (FRM runs without one)
        </label>
      )}
      {tested && <TestResult result={tested} />}
      {nothingToChange && <p role="status">Nothing to change.</p>}
      {saveError && !busy && <ManagementError error={saveError} />}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="border-accent bg-accent text-on-accent">
          {save.isPending ? "Saving…" : mode.kind === "create" ? "Add server" : "Save"}
        </button>
        {mode.kind === "create" && (
          <button type="button" disabled={busy} onClick={runTest}>
            {test.isPending ? "Testing…" : "Test connection"}
          </button>
        )}
        <button type="button" disabled={save.isPending} onClick={() => onDone("")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
