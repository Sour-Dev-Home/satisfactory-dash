import { describe, expect, it } from "vitest";
import type { PlannerDesignation, PlannerDesignationMember } from "@satisfactory-dash/shared";
import { applyReplace, type StoredDesignation } from "../demo/designationStore";
import { dissolveRequest, groupRequest, moveRequest, ungroupRequest, undoRequest, type OpResult } from "./designationOps";

// Hunt: random forests, random group/move/ungroup/dissolve, then the server's rules as invariants on the result and an
// exact undo.
const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number): PlannerDesignationMember => ({ id: `B${n}`, c: "Build_ConstructorMk1_C", x: n * 8, y: 0 });

let seed = 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const int = (n: number) => Math.floor(rnd() * n);
const num = (id: string) => Number(id.slice(-12));

function forest(): StoredDesignation[] {
  const n = 3 + int(7);
  const out: StoredDesignation[] = [];
  const depth = new Map<number, number>();
  const hasKids = new Set<number>();
  for (let i = 1; i <= n; i++) {
    let parent: number | null = null;
    if (i > 1 && rnd() < 0.6) {
      const p = 1 + int(i - 1);
      if ((depth.get(p) ?? 1) < 3) parent = p;
    }
    depth.set(i, parent === null ? 1 : (depth.get(parent) ?? 1) + 1);
    if (parent !== null) hasKids.add(parent);
    out.push({
      id: uuid(i),
      name: `D${i}`,
      mode: "core",
      members: [],
      createdAt: `2026-10-0${1 + (i % 8)}T10:00:00.000Z`,
      updatedAt: "2026-10-27T10:00:00.000Z",
      revision: 1 + int(3),
      parentId: parent === null ? null : uuid(parent),
    });
  }
  for (const d of out) if (!hasKids.has(num(d.id)) || rnd() < 0.3) d.members = [member(num(d.id))];
  return out;
}

function violations(list: readonly PlannerDesignation[]): string[] {
  const by = new Map(list.map((d) => [d.id, d]));
  const bad: string[] = [];
  const named = new Set(list.flatMap((d) => (d.parentId == null ? [] : [d.parentId])));
  for (const d of list) {
    if (d.parentId != null && !by.has(d.parentId)) bad.push(`dangling ${d.name}`);
    if (d.members.length === 0 && !named.has(d.id)) bad.push(`empty leaf ${d.name}`);
    let depth = 1;
    for (let p = d.parentId ?? null, g = 0; p !== null && g < 10; p = by.get(p)?.parentId ?? null, g++) depth++;
    if (depth > 3) bad.push(`depth ${d.name}`);
  }
  return bad;
}
const norm = (l: readonly PlannerDesignation[]) =>
  [...l].sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => ({ id: x.id, name: x.name, p: x.parentId ?? null, m: x.members.map((y) => y.id).sort() }));
const brief = (l: readonly PlannerDesignation[]) => JSON.stringify(l.map((d) => [num(d.id), d.parentId == null ? null : num(d.parentId), d.members.length]));

describe("hierarchy ops, random forests", () => {
  it("every accepted op leaves a valid tree, keeps every machine, and undoes exactly", () => {
    let accepted = 0;
    for (let round = 0; round < 1500; round++) {
      const all = forest();
      if (violations(all).length > 0) continue;
      const chosen = [...all].sort(() => rnd() - 0.5).slice(0, 1 + int(3));
      const kind = int(4);
      let res: OpResult;
      if (kind === 0) res = groupRequest({ all, picks: chosen.map((designation) => ({ designation })), name: "G", parentId: chosen[0]!.parentId ?? null, newId: uuid(999) });
      else if (kind === 1) res = moveRequest({ all, picks: chosen.map((designation) => ({ designation })), to: rnd() < 0.3 ? null : all[int(all.length)]!.id });
      else if (kind === 2) res = ungroupRequest({ all, parent: chosen[0]! });
      else res = dissolveRequest(chosen[0]!, all);
      if (!res.ok) continue;
      const ctx = `kind ${kind} forest ${brief(all)} picks ${JSON.stringify(chosen.map((c) => num(c.id)))} req ${JSON.stringify(res.request)}`;
      const done = applyReplace(all, res.request, NOW, () => uuid(998));
      if (!done.ok) throw new Error(`server refuses: ${done.code} ${ctx}`);
      accepted++;
      if (kind !== 3) {
        const before = all.flatMap((d) => d.members.map((m) => m.id)).sort();
        expect(done.next.flatMap((d) => d.members.map((m) => m.id)).sort(), ctx).toEqual(before);
      }
      expect(violations(done.next), ctx).toEqual([]);
      const undo = undoRequest(res.preImage, done.response);
      if (!undo.ok) throw new Error(`undo refused ${undo.reason} ${ctx}`);
      const back = applyReplace(done.next, undo.request, NOW + 1000, () => uuid(997));
      if (!back.ok) throw new Error(`undo rejected ${back.code} ${ctx}`);
      expect(norm(back.next), ctx).toEqual(norm(all));
    }
    expect(accepted).toBeGreaterThan(300);
  });
});
