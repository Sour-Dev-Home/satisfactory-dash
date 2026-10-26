import type { ReactNode } from "react";
import { useBasicData } from "../api/basicData";

/** The one calm line for a server that reports only the game's own API (ADR-0057). Not an error and not an alert. */
export function BasicDataNotice() {
  return (
    <section className="panel" role="status" data-basic-data="">
      <p className="text-muted">
        <strong>Basic data:</strong> this server reports only the game&apos;s own API, so power, factory and map
        aren&apos;t available.
      </p>
    </section>
  );
}

/** A page's content, or the notice in its place on a server with basic data only. */
export function BasicDataGate({ children }: { children: ReactNode }) {
  return useBasicData() ? <BasicDataNotice /> : children;
}
