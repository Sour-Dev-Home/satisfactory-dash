import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { ToApp, ToPair } from "./ToApp";

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/pair" element={<ToPair />} />
        <Route path="/app/*" element={<Where />} />
        <Route path="*" element={<ToApp />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId("where").textContent;
}

describe("redirects outside the app", () => {
  it("/pair, the address the mod prints, opens the pair page", () => {
    expect(renderAt("/pair")).toBe("/app/pair");
  });

  it("/pair drops any query string, so no link can prefill a code (ADR-0051)", () => {
    expect(renderAt("/pair?code=ABCD-EFGH-JKLM")).toBe("/app/pair");
  });

  it("any other path still goes to /app with its query string", () => {
    expect(renderAt("/nowhere?scenario=pair")).toBe("/app?scenario=pair");
  });
});
