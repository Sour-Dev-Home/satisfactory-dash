import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ResourceNodesLayerDataSchema } from "@satisfactory-dash/shared";
import { resourceNodesSample } from "@satisfactory-dash/shared/fixtures";
import { RawFrmResourceNodeSchema } from "../rawSchemas.js";
import { mapResourceNode, mapResourceNodes } from "./resourceNodesMapper.js";

// docs-vault/raw-sources/captured-responses/frm-getResourceNode-2026-09-27-trimmed.json.
const CAPTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs-vault/raw-sources/captured-responses/frm-getResourceNode-2026-09-27-trimmed.json",
);

function readCaptureArray(filePath: string): unknown {
  const text = readFileSync(filePath, "utf8");
  const jsonLine = text.split("\n").find((line) => line.startsWith("["));
  if (jsonLine === undefined) throw new Error(`no JSON array line found in ${filePath}`);
  return JSON.parse(jsonLine);
}

describe("mapResourceNodes (ADR-0038 M2, #352 follow-up)", () => {
  it("projects the real capture into exactly what packages/shared/fixtures/map.ts's resourceNodesSample claims", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    // The fixture samples the capture's first 6 items (Node) plus item 11 (the one Fracking Satellite).
    const sampled = [...raw.slice(0, 6), raw[10]];
    expect(mapResourceNodes(sampled)).toEqual(resourceNodesSample.data);
  });

  it("the mapped output passes the M1 contract schema (ResourceNodesLayerDataSchema)", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    expect(ResourceNodesLayerDataSchema.safeParse(mapResourceNodes(raw)).success).toBe(true);
  });

  it("maps NodeType Node -> node and Fracking Satellite -> frackingSatellite (the whole point of this follow-up)", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    const byNodeType = (nodeType: string) => mapResourceNodes(raw).filter((n) => n.nodeType === nodeType);
    expect(byNodeType("node")).toHaveLength(10);
    expect(byNodeType("frackingSatellite")).toHaveLength(4);
  });

  it("passes an unrecognized future NodeType through unchanged rather than throwing", () => {
    const node = mapResourceNode({
      Name: "Bauxite",
      Purity: "Pure",
      NodeType: "Geyser",
      Exploited: false,
      location: { x: 0, y: 0, z: 0 },
    });
    expect(node.nodeType).toBe("Geyser");
  });

  it("lowercases Purity (Normal/Impure/Pure), never using the separate typo'd EnumPurity field", () => {
    const purities = new Set(
      z
        .array(RawFrmResourceNodeSchema)
        .parse(readCaptureArray(CAPTURE_PATH))
        .map((n) => mapResourceNode(n).purity),
    );
    expect([...purities].sort()).toEqual(["impure", "normal", "pure"]);
  });

  it("rounds location x/y (centimetres) to the nearest whole metre", () => {
    const node = mapResourceNode({ Name: "x", Purity: "Normal", NodeType: "Node", Exploited: false, location: { x: 149, y: -151, z: 0 } });
    expect([node.x, node.y]).toEqual([1, -2]);
  });

  // test-hunter pass: the frm-getResourceNode-2026-09-27-trimmed.json capture header itself says
  // "In the full response: 459 Node, 118 Fracking Satellite, 31 Geyser" -- a real, live-observed
  // third NodeType value that never made it into the 14-item trimmed sample (the sampling only
  // reached Node/Fracking Satellite combos before hitting its 14-item cap), and so isn't in
  // NODE_TYPE_CAMEL_CASE. It falls through the documented pass-through path -- covered by the
  // existing "unrecognized future NodeType" test above using this exact value -- but note what
  // that means for a real server today: a resourceNodes layer will contain nodeType: "node" and
  // nodeType: "frackingSatellite" (camelCase) side by side with nodeType: "Geyser" (untouched,
  // PascalCase-with-a-space-removed), which is an inconsistent casing convention for the same
  // field on wire data a frontend will branch on. Not asserting this is wrong -- the code comment
  // says it's deliberate -- just pinning down that it does NOT get camelCased like its siblings.
  it("does NOT camelCase the real, live-observed 'Geyser' NodeType (documented gap, not a crash)", () => {
    const node = mapResourceNode({ Name: "Water", Purity: "Pure", NodeType: "Geyser", Exploited: false, location: { x: 0, y: 0, z: 0 } });
    expect(node.nodeType).toBe("Geyser");
    expect(node.nodeType).not.toBe("geyser");
  });

  it("is case-sensitive and whitespace-sensitive: a variant of a known NodeType is not recognized either", () => {
    // FRM has never been observed sending these variants; this documents that the lookup is an
    // exact string match, not a normalized one, so any future casing/whitespace drift from FRM
    // (or a mod) silently falls through to raw pass-through rather than being caught by the table.
    for (const variant of ["node", "NODE", " Node", "Node ", "fracking satellite", "Fracking  Satellite"]) {
      const node = mapResourceNode({ Name: "x", Purity: "Normal", NodeType: variant, Exploited: false, location: { x: 0, y: 0, z: 0 } });
      expect(node.nodeType).toBe(variant); // unchanged, not normalized to node/frackingSatellite
    }
  });

  it("maps an empty array to an empty array without throwing", () => {
    expect(mapResourceNodes([])).toEqual([]);
  });

  it("maps a large batch (608 items, the full live capture's documented size) without throwing or dropping items", () => {
    const base = { Name: "Iron Ore", Purity: "Normal", NodeType: "Node", Exploited: false, location: { x: 0, y: 0, z: 0 } };
    const many = Array.from({ length: 608 }, (_, i) => ({ ...base, location: { x: i * 100, y: -i * 100, z: 0 } }));
    const mapped = mapResourceNodes(many);
    expect(mapped).toHaveLength(608);
    expect(mapped[607]).toEqual({ type: "Iron Ore", purity: "normal", nodeType: "node", x: 607, y: -607, exploited: false });
  });
});
