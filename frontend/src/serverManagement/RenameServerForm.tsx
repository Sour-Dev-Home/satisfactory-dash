import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, RenameServerRequestSchema, type AgentServer } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { MANAGED_KEY, queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";

const NAME_ERROR = "Enter a name of up to 64 characters.";

/**
 * A name can be refused for its length or for characters that aren't printable text (#271); the
 * shared schema says which, so its own message is shown rather than one line for every refusal.
 */
function nameError(issue: { code?: string; message?: string } | undefined): string {
  if (issue?.code === "too_small") return "Enter a name.";
  if (issue?.code === "custom" && issue.message) return issue.message.endsWith(".") ? issue.message : `${issue.message}.`;
  return NAME_ERROR;
}

/**
 * The operator renames a server (ADR-0031's own route, since a server reached through the mod has no stored connection).
 * ADR-0066: the name is the only thing left to edit; the connection is the mod's.
 */
export function RenameServerForm({ server, onDone }: { server: AgentServer; onDone: (message: string) => void }) {
  const client = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(server.displayName);
  const [error, setError] = useState<string>();
  const [nothingToChange, setNothingToChange] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A second submit before React re-renders (isPending only updates on the next render) is dropped here,
  // rather than becoming a second request.
  const submitting = useRef(false);

  const save = useMutation({
    mutationFn: (displayName: string) => apiSend(endpoints.serverManagement.renameAgent, { displayName }, server.id),
    onSuccess: async ({ server: saved }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: MANAGED_KEY }),
        client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
      ]);
      onDone(`Saved ${saved.displayName}.`);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === server.displayName) {
      setNothingToChange(true);
      return;
    }
    if (submitting.current || save.isPending) return;
    const parsed = RenameServerRequestSchema.safeParse({ displayName: name });
    if (!parsed.success) {
      setError(nameError(parsed.error.issues.find((issue) => issue.path[0] === "displayName")));
      input.current?.focus();
      return;
    }
    submitting.current = true;
    save.mutate(name);
  }

  const errorId = `${formId}-name-error`;
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${formId}-title`}
      className="grid gap-4 rounded-card border border-line bg-surface p-5"
    >
      <h3 id={`${formId}-title`} className="mb-0">
        Rename server<span className="font-normal text-muted">: {server.displayName}</span>
      </h3>
      <div className="grid content-start gap-1.5 text-sm">
        <label htmlFor={`${formId}-name`}>Name</label>
        <input
          id={`${formId}-name`}
          ref={input}
          className="aria-[invalid=true]:border-bad"
          name="displayName"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
            setNothingToChange(false);
          }}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <span id={errorId} className="font-medium text-bad">
            {error}
          </span>
        )}
      </div>
      {nothingToChange && <p role="status">Nothing to change.</p>}
      {save.error && !save.isPending && <ErrorNotice error={save.error} />}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={save.isPending} className="border-accent bg-accent text-on-accent">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={save.isPending} onClick={() => onDone("")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
