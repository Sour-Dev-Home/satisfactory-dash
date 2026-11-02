import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClient } from "../api/queries";
import type { PageQuery } from "../ui/usePageReveal";
import { AdSlot } from "./AdSlot";
import { ADS_MARKER_CONTENT, ADS_MARKER_NAME } from "./config";

// Edge cases beyond ads.test.tsx: a slot needs data for ALL of its page's primary queries, never an empty list, and
// StrictMode's double mount still asks AdSense once.
const UNITS = { overview: "1234567890", power: null, factory: null, planner: null };
const q = (name: string) => ({ queryKey: ["edge", name], queryFn: () => Promise.resolve(name) }) as unknown as PageQuery;

function setup(queries: PageQuery[], strict = false) {
  const meta = document.createElement("meta");
  meta.name = ADS_MARKER_NAME;
  meta.content = ADS_MARKER_CONTENT;
  document.head.append(meta);
  const client = createQueryClient();
  const tree = (
    <QueryClientProvider client={client}>
      <AdSlot placement="overview" queries={queries} units={UNITS} />
    </QueryClientProvider>
  );
  return { client, ...render(strict ? <StrictMode>{tree}</StrictMode> : tree) };
}

afterEach(() => {
  document.head.querySelectorAll(`meta[name="${ADS_MARKER_NAME}"]`).forEach((el) => el.remove());
  delete window.adsbygoogle;
});

describe("AdSlot edges", () => {
  it("waits for every primary query, not just one", async () => {
    const { client, container } = setup([q("a"), q("b")]);
    client.setQueryData(["edge", "a"], 1);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    client.setQueryData(["edge", "b"], 2);
    await waitFor(() => expect(screen.getByRole("region", { name: "Advertisements" })).toBeInTheDocument());
  });

  it("renders nothing for a page with no primary queries", () => {
    const { container } = setup([]);
    expect(container).toBeEmptyDOMElement();
    expect(window.adsbygoogle).toBeUndefined();
  });

  it("asks AdSense once under StrictMode's double mount", async () => {
    const { client } = setup([q("a")], true);
    client.setQueryData(["edge", "a"], 1);
    await waitFor(() => expect(window.adsbygoogle).toHaveLength(1));
  });
});
