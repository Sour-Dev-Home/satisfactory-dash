import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClient } from "../api/queries";
import { SourceFooter } from "../components/SourceFooter";
import type { PageQuery } from "../ui/usePageReveal";
import { AdSlot } from "./AdSlot";
import { AD_CLIENT, AD_UNITS, ADS_MARKER_CONTENT, ADS_MARKER_NAME, isAdUnitId, type AdPlacement } from "./config";
import { adsOn, requestAd, showPrivacySettings } from "./google";

// ADR-0021 amendment 3, build step 4: with the Worker's marker absent (the switch off) nothing renders; with it, the
// footer's consent link and the slots do.

function setMarker(content: string | null = ADS_MARKER_CONTENT) {
  document.head.querySelectorAll(`meta[name="${ADS_MARKER_NAME}"]`).forEach((el) => el.remove());
  if (content === null) return;
  const meta = document.createElement("meta");
  meta.name = ADS_MARKER_NAME;
  meta.content = content;
  document.head.append(meta);
}

afterEach(() => {
  setMarker(null);
  delete window.adsbygoogle;
  delete window.googlefc;
});

const UNITS: Record<AdPlacement, string | null> = { overview: "1234567890", power: "2345678901", factory: null, planner: "3456789012" };
const KEY = ["ads-test", "page"];
const QUERY = { queryKey: KEY, queryFn: () => Promise.resolve("data") } as unknown as PageQuery;

function renderSlot(placement: AdPlacement, { data = true, units = UNITS }: { data?: boolean; units?: typeof UNITS } = {}) {
  const client = createQueryClient();
  if (data) client.setQueryData(KEY, "data");
  const view = render(
    <QueryClientProvider client={client}>
      <AdSlot placement={placement} queries={[QUERY]} units={units} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe("the ad unit config", () => {
  it("holds only placeholders or numeric AdSense unit ids: never invented ones", () => {
    for (const [placement, unit] of Object.entries(AD_UNITS)) expect(unit === null || isAdUnitId(unit), placement).toBe(true);
  });

  it("rejects anything that isn't digits, so nothing else is written into the page", () => {
    for (const bad of ["", "12ab", "1234567890\"", " 123", "123 ", null, undefined]) expect(isAdUnitId(bad)).toBe(false);
    expect(isAdUnitId("1234567890")).toBe(true);
  });
});

describe("adsOn (the Worker's marker)", () => {
  it("is off without the marker: the switch off, vite preview, the e2e suite", () => {
    expect(adsOn()).toBe(false);
  });

  it("is on with the marker the Worker inserts", () => {
    setMarker();
    expect(adsOn()).toBe(true);
  });

  it("is off for a marker with any other content, or one in the body", () => {
    setMarker("off");
    expect(adsOn()).toBe(false);
    setMarker(null);
    const meta = document.createElement("meta");
    meta.name = ADS_MARKER_NAME;
    meta.content = ADS_MARKER_CONTENT;
    document.body.append(meta);
    expect(adsOn()).toBe(false);
    meta.remove();
  });
});

describe("showPrivacySettings (E7, E10)", () => {
  it("queues Google's revocation message through googlefc.callbackQueue, creating the queue if needed", () => {
    showPrivacySettings();
    expect(window.googlefc?.callbackQueue).toHaveLength(1);
    let shown = 0;
    window.googlefc!.showRevocationMessage = () => shown++;
    (window.googlefc!.callbackQueue![0] as () => void)();
    expect(shown).toBe(1);
  });

  it("uses the queue Google's script already set up", () => {
    const queue: unknown[] = [];
    window.googlefc = { callbackQueue: queue };
    showPrivacySettings();
    expect(queue).toHaveLength(1);
  });

  it("does nothing harmful when run before Google's script defines the function", () => {
    showPrivacySettings();
    expect(() => (window.googlefc!.callbackQueue![0] as () => void)()).not.toThrow();
  });
});

describe("requestAd (U-E5)", () => {
  it("pushes one request onto adsbygoogle, creating it if needed", () => {
    requestAd();
    expect(window.adsbygoogle).toEqual([{}]);
  });

  it("swallows a failure from Google's code: the slot stays empty, no retry", () => {
    let calls = 0;
    window.adsbygoogle = { push: () => { calls++; throw new Error("no slot"); } } as unknown as unknown[];
    expect(() => requestAd()).not.toThrow();
    expect(calls).toBe(1);
  });
});

describe("AdSlot", () => {
  it("renders nothing with ads off, even with a unit and data: no element, so no space and no layout change", () => {
    const { container } = renderSlot("overview");
    expect(container).toBeEmptyDOMElement();
    expect(window.adsbygoogle).toBeUndefined();
  });

  it("with ads on, reserves the fixed slot size, labelled Advertisements, and asks AdSense once", () => {
    setMarker();
    renderSlot("overview");
    const slot = screen.getByRole("region", { name: "Advertisements" });
    expect(slot).toHaveClass("mt-8");
    const ins = slot.querySelector("ins")!;
    expect(ins).toHaveClass("adsbygoogle", "block", "max-w-full", "h-ad-phone-h", "w-ad-phone-w", "sm:h-ad-mid-h", "sm:w-ad-mid-w", "lg:h-ad-wide-h", "lg:w-ad-wide-w");
    expect(ins).toHaveAttribute("data-ad-client", AD_CLIENT);
    expect(ins).toHaveAttribute("data-ad-slot", "1234567890");
    expect(ins).not.toHaveAttribute("style");
    expect(window.adsbygoogle).toEqual([{}]);
  });

  it("asks once per unit across re-renders", () => {
    setMarker();
    const { rerender, client } = renderSlot("power");
    rerender(
      <QueryClientProvider client={client}>
        <AdSlot placement="power" queries={[QUERY]} units={UNITS} />
      </QueryClientProvider>,
    );
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it("renders nothing for a placement whose unit is still a placeholder", () => {
    setMarker();
    const { container } = renderSlot("factory");
    expect(container).toBeEmptyDOMElement();
    expect(window.adsbygoogle).toBeUndefined();
  });

  it("renders one slot per placement with the shipped config: every unit is the owner's real AdSense id", () => {
    setMarker();
    for (const [placement, unit] of Object.entries(AD_UNITS) as [AdPlacement, string | null][]) {
      expect(isAdUnitId(unit), placement).toBe(true);
      const { container, unmount } = renderSlot(placement, { units: AD_UNITS });
      expect(container.querySelector(`ins[data-ad-slot="${unit}"]`), placement).not.toBeNull();
      unmount();
    }
  });

  it("waits for the page's data: none while loading or after a failed first read, then appears", async () => {
    setMarker();
    const { container, client } = renderSlot("overview", { data: false });
    expect(container).toBeEmptyDOMElement();
    client.setQueryData(KEY, "data");
    await waitFor(() => expect(screen.getByRole("region", { name: "Advertisements" })).toBeInTheDocument());
  });
});

describe("the footer's consent link", () => {
  it("is not rendered with ads off", () => {
    render(<SourceFooter commitSha="" />);
    expect(screen.queryByRole("button", { name: "Privacy and cookie settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("contentinfo").querySelectorAll("a, button")).toHaveLength(3);
  });

  it("is rendered with ads on, as a button (E10's javascript: link is blocked by the strict CSP), and opens Google's message", () => {
    setMarker();
    render(<SourceFooter commitSha="" />);
    const button = screen.getByRole("button", { name: "Privacy and cookie settings" });
    expect(button).toHaveAttribute("type", "button");
    let shown = 0;
    window.googlefc = { callbackQueue: [], showRevocationMessage: () => shown++ };
    fireEvent.click(button);
    expect(window.googlefc.callbackQueue).toHaveLength(1);
    (window.googlefc.callbackQueue![0] as () => void)();
    expect(shown).toBe(1);
  });

  it("adds no Do Not Sell link of its own: Google's US message renders it on AdSense sites (U-E1, U-E2)", () => {
    setMarker();
    render(<SourceFooter commitSha="" />);
    expect(screen.queryByText(/Do Not Sell/i)).not.toBeInTheDocument();
  });
});
