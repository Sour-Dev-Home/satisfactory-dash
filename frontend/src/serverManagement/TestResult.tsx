import type { TestConnectionResponse } from "@satisfactory-dash/shared";
import { cn } from "../lib/cn";
import { checkLines } from "./messages";

/** A connection test's pass/fail, per check, as text (the colour only repeats it). */
export function TestResult({ result }: { result: TestConnectionResponse }) {
  return (
    <div role="status" className="grid gap-1 text-sm">
      <p className={cn("mb-0 font-semibold", result.ok ? "text-ok" : "text-warn")}>
        {result.ok ? "Connection test passed." : "Connection test failed."}
      </p>
      <ul className="grid gap-0.5">
        {checkLines(result).map((line) => (
          <li key={line.label}>
            {line.label}: {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
