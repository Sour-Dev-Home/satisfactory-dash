import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreateServerRequestSchema,
  endpoints,
  ownValue,
  RenameServerRequestSchema,
  RESERVED_SERVER_IDS,
  SwitchToLocalRequestSchema,
  TestConnectionRequestSchema,
  UpdateServerRequestSchema,
  type AgentServer,
  type ServerConnection,
  type TestConnectionResponse,
} from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { MANAGED_KEY, queries } from "../api/queries";
import { cn } from "../lib/cn";
import { isNonLoopbackIpLiteral } from "./hosts";
import { ManagementError } from "./ManagementError";
import { LOOPBACK_ONLY } from "./messages";
import { TestResult } from "./TestResult";

/**
 * create: a new server. edit: any field; a blank token keeps the stored one. repair: the stored
 * tokens can't be read, so both are entered again. rename: only the name (works whatever the
 * tokens' state). For a server reached through the game PC's agent (ADR-0031), which has no stored
 * connection: renameAgent, only the name; switchToLocal, a connection entered afresh so this backend
 * reads the server itself again (the backend tests it first, then revokes the agent).
 */
export type FormMode =
  | { kind: "create" }
  | { kind: "edit" | "repair" | "rename"; server: ServerConnection }
  | { kind: "renameAgent" | "switchToLocal"; server: AgentServer };

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
  renameAgent: ["displayName"],
  switchToLocal: ["host", "apiPort", "frmPort", "apiToken", "frmToken"],
};

const TITLE: Record<FormMode["kind"], string> = {
  create: "Add a server",
  edit: "Edit server",
  repair: "Re-enter both tokens",
  rename: "Rename server",
  renameAgent: "Rename server",
  switchToLocal: "Switch back to reading the server directly",
};

/** The stored connection behind a mode, when it has one (an agent server has none). */
function connectionOf(mode: FormMode): ServerConnection | undefined {
  return mode.kind === "edit" || mode.kind === "repair" || mode.kind === "rename" ? mode.server : undefined;
}

type Values = Record<Field, string>;

function initialValues(mode: FormMode): Values {
  const server = connectionOf(mode);
  return {
    id: "",
    displayName: mode.kind === "create" ? "" : mode.server.displayName,
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
  if (mode.kind === "switchToLocal") {
    return {
      host: v.host,
      apiPort: port(v.apiPort),
      frmPort: port(v.frmPort),
      apiToken: v.apiToken,
      ...(v.frmToken !== "" && { frmToken: v.frmToken }),
    };
  }
  if (mode.kind === "rename" || mode.kind === "renameAgent") {
    return v.displayName.trim() === mode.server.displayName ? undefined : { displayName: v.displayName };
  }
  if (mode.kind === "repair") return { apiToken: v.apiToken, frmToken: v.frmToken === "" ? null : v.frmToken };
  const server = connectionOf(mode);
  if (!server) return undefined;
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

type Issues = readonly { path: readonly PropertyKey[]; code?: string; message?: string }[];

/**
 * A name can be refused for its length or for characters that aren't printable text (#271); the
 * shared schema says which, so its own message is shown rather than one line for every refusal.
 */
function nameError(issue: Issues[number]): string {
  if (issue.code === "too_small") return "Enter a name.";
  if (issue.code === "custom" && issue.message) return issue.message.endsWith(".") ? issue.message : `${issue.message}.`;
  return FIELD_ERROR.displayName;
}

function fieldErrors(issues: Issues, values: Values): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0] as Field;
    // The path comes from validation: own keys only (#368).
    const message = ownValue(FIELD_ERROR, field);
    if (message === undefined || errors[field]) continue;
    errors[field] =
      field === "id" && (RESERVED_SERVER_IDS as readonly string[]).includes(values.id.trim())
        ? "That id is reserved."
        : field === "displayName"
          ? nameError(issue)
          : message;
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
  const shows = ownValue(SHOWS, mode.kind) ?? [];
  const named = mode.kind === "create" ? undefined : mode.server;
  const server = connectionOf(mode);
  const switching = mode.kind === "switchToLocal";

  // The token travels through these refs, not as a mutation's `variables`: TanStack keeps a
  // mutation's variables in its cache for minutes (see LoginForm.tsx), and a token shouldn't
  // live there any more than a password should. Each ref is cleared as soon as its request is
  // built, and the two are separate so a save and a test in flight together can't clobber it.
  const pendingSave = useRef<Record<string, unknown> | null>(null);
  const pendingTest = useRef<Record<string, unknown> | null>(null);

  // Create, update and switch answer the stored connection; renaming an agent server answers the
  // agent server. What happens next needs only the id and name.
  const save = useMutation<{ server: { id: string; displayName: string } }>({
    mutationFn: () => {
      const body = pendingSave.current;
      pendingSave.current = null;
      if (!body) throw new Error("save submitted without a body");
      if (mode.kind === "create") return apiSend(endpoints.serverManagement.create, body as never);
      if (mode.kind === "switchToLocal") {
        return apiSend(endpoints.serverManagement.switchToLocal, body as never, mode.server.id);
      }
      if (mode.kind === "renameAgent") return apiSend(endpoints.serverManagement.renameAgent, body as never, mode.server.id);
      return apiSend(endpoints.serverManagement.update, body as never, mode.server.id);
    },
    onSuccess: async ({ server: saved }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: MANAGED_KEY }),
        client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
        // Switching back revokes the agent: Settings' agent section must not show it still enrolled.
        switching && client.invalidateQueries({ queryKey: queries.agentStatus(saved.id).queryKey }),
      ]);
      onDone(
        mode.kind === "create"
          ? `Added ${saved.displayName}.`
          : switching
            ? `${saved.displayName} is read directly again, and its agent is revoked. Stop the agent on the game PC (its Scheduled Task).`
            : `Saved ${saved.displayName}.`,
      );
    },
  });
  const test = useMutation({
    mutationFn: () => {
      const body = pendingTest.current;
      pendingTest.current = null;
      if (!body) throw new Error("test submitted without a body");
      return apiSend(endpoints.serverManagement.testConnection, body as never);
    },
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
    const schema =
      mode.kind === "create"
        ? CreateServerRequestSchema
        : mode.kind === "switchToLocal"
          ? SwitchToLocalRequestSchema
          : mode.kind === "renameAgent"
            ? RenameServerRequestSchema
            : UpdateServerRequestSchema;
    // A second submit before the first request is built (isPending only updates on the next
    // render) is dropped here, rather than becoming a failed mutation that shows an error.
    if (pendingSave.current || save.isPending) return;
    if (validated(schema, body)) {
      pendingSave.current = body;
      save.mutate();
    }
  }

  function runTest() {
    const body = bodyFor({ kind: "create" }, values, false)!;
    const { id: _id, displayName: _name, ...connection } = body;
    if (pendingTest.current || test.isPending) return;
    if (validated(TestConnectionRequestSchema, connection)) {
      pendingTest.current = connection;
      test.mutate();
    }
  }

  const field = (
    name: Field,
    label: string,
    extra: { hint?: ReactNode; password?: boolean; numeric?: boolean; wide?: boolean } = {},
  ) => {
    const errorId = `${formId}-${name}-error`;
    const hintId = `${formId}-${name}-hint`;
    const describedBy = [extra.hint && hintId, errors[name] && errorId].filter(Boolean).join(" ") || undefined;
    // The hint and error sit outside the <label>, so the field's name is only its label.
    return (
      <div key={name} className={cn("grid content-start gap-1.5 text-sm", extra.wide && "sm:col-span-2")}>
        <label htmlFor={`${formId}-${name}`}>{label}</label>
        <input
          id={`${formId}-${name}`}
          className="aria-[invalid=true]:border-bad"
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
          <span id={errorId} className="font-medium text-bad">
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
        {ownValue(TITLE, mode.kind)}
        {named && <span className="font-normal text-muted">: {named.displayName}</span>}
      </h3>
      {switching && (
        <p className="mb-0 text-sm text-muted">
          This server is read through the game PC's agent. Enter how this dashboard can reach the game server itself.
          The connection is tested first and nothing changes if it fails. Then the agent is revoked; members and
          history stay. Afterwards, stop the agent on the game PC.
        </p>
      )}
      {mode.kind === "repair" && (
        <p className="mb-0 text-sm text-muted">
          The saved tokens can't be read by this backend (its key changed). Enter both again; leave the FRM token
          blank if FRM runs without one.
        </p>
      )}
      {/* Pairs by meaning from sm up: id + name (or a full-width name), host alone, the two ports,
          the two tokens. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {shows.includes("id") &&
          field("id", "Server id", { hint: "Used in links. Lowercase letters, digits and dashes; can't be changed." })}
        {shows.includes("displayName") && field("displayName", "Name", { wide: !shows.includes("id") })}
        {shows.includes("host") &&
          field("host", "Host", {
            wide: true,
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
        <label className="flex min-h-touch items-center gap-2 text-sm">
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
          {save.isPending ? "Saving…" : mode.kind === "create" ? "Add server" : switching ? "Test and switch back" : "Save"}
        </button>
        {(mode.kind === "create" || switching) && (
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
