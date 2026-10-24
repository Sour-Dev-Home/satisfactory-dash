import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type PlannerNode } from "@satisfactory-dash/shared";
import { factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { GroupPanel, PANEL_MAX_MACHINES } from "./GroupPanel";

const base = factoryMixed.data.buildings[0];
const nodeWith = (ids: string[]): PlannerNode => ({
  key: "k", kind: "machines", className: "C", name: "<img src=x onerror=alert(1)>", recipe: "R", count: ids.length, machineIds: ids,
  stateCounts: { producing: ids.length }, products: [], ingredients: [], at: { x: 0, y: 0 }, siteKey: "s", loop: false,
});

async function panelFor(ids: string[], inFactory: number) {
  const buildings = Array.from({ length: inFactory }, (_, i) => ({ ...base, id: `m${i}`, name: `<b>M${i}</b>` }));
  server.use(http.get(endpoints.factory.route, () => HttpResponse.json({ ...factoryMixed, data: { ...factoryMixed.data, buildings } })));
  renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <GroupPanel id="p" node={nodeWith(ids)} findings={undefined} onClose={() => {}} />
    </ServerContext>,
  );
  return screen.findByRole("list", { name: /^Machines in/ });
}

describe("GroupPanel hunt", () => {
  it("lists exactly the cap and says how many more, singular for one", async () => {
    const ids = Array.from({ length: PANEL_MAX_MACHINES + 1 }, (_, i) => `m${i}`);
    const list = await panelFor(ids, ids.length);
    expect(within(list).getAllByRole("listitem")).toHaveLength(PANEL_MAX_MACHINES);
    expect(screen.getByText("1 more machine is not listed here.")).toBeInTheDocument();
  });

  it("exactly the cap shows no note; many more says plural", async () => {
    const ids = Array.from({ length: PANEL_MAX_MACHINES }, (_, i) => `m${i}`);
    const list = await panelFor(ids, ids.length);
    expect(within(list).getAllByRole("listitem")).toHaveLength(PANEL_MAX_MACHINES);
    expect(screen.queryByText(/not listed here/)).toBeNull();
  });

  it("game-server text is text, never markup", async () => {
    const list = await panelFor(["m0"], 1);
    expect(list.querySelector("b")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("<b>M0</b>")).toBeInTheDocument();
  });
});

describe("source hygiene", () => {
  const root = join(__dirname, "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const src = files(root).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it("only layoutSite.ts imports dagre", () => {
    const importers = src.filter((f) => /from\s+["']@dagrejs\/dagre["']|import\(["']@dagrejs\/dagre/.test(readFileSync(f, "utf8")));
    expect(importers.map((f) => f.split(/[\\/]/).pop())).toEqual(["layoutSite.ts"]);
  });

  it("the graph files never use innerHTML or dangerouslySetInnerHTML or inline style", () => {
    for (const f of src.filter((f) => f.includes(join("planner", "graph")))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/innerHTML|dangerouslySetInnerHTML|\bstyle=/);
    }
  });
});
