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

const baseNode = { Name: "x", Purity: "Normal", NodeType: "Node", Exploited: false, location: { x: 0, y: 0, z: 0 } };

describe("mapResourceNodes (ADR-0038 M2, architect follow-up on #367)", () => {
  it("projects the real capture into exactly what packages/shared/fixtures/map.ts's resourceNodesSample claims", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    // The fixture samples the capture's first 6 items (Node) plus item 11 (the one Fracking Satellite).
    const sampled = [...raw.slice(0, 6), raw[10]!];
    const { data, dropped } = mapResourceNodes(sampled);
    expect(data).toEqual(resourceNodesSample.data);
    expect(dropped).toBe(0);
  });

  it("the mapped output passes the M1 contract schema (ResourceNodesLayerDataSchema)", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    expect(ResourceNodesLayerDataSchema.safeParse(mapResourceNodes(raw).data).success).toBe(true);
  });

  it("maps every known NodeType (Node, Fracking Satellite, Geyser) to its camelCase form", () => {
    expect(mapResourceNode({ ...baseNode, NodeType: "Node" })?.nodeType).toBe("node");
    expect(mapResourceNode({ ...baseNode, NodeType: "Fracking Satellite" })?.nodeType).toBe("frackingSatellite");
    expect(mapResourceNode({ ...baseNode, NodeType: "Geyser" })?.nodeType).toBe("geyser");
  });

  it("real capture counts: 10 node, 4 frackingSatellite", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    const byNodeType = (nodeType: string) => mapResourceNodes(raw).data.filter((n) => n.nodeType === nodeType);
    expect(byNodeType("node")).toHaveLength(10);
    expect(byNodeType("frackingSatellite")).toHaveLength(4);
  });

  it("runs an unrecognized NodeType through the generic camelCase algorithm, not a pass-through", () => {
    expect(mapResourceNode({ ...baseNode, NodeType: "Some New Type" })?.nodeType).toBe("someNewType");
    expect(mapResourceNode({ ...baseNode, NodeType: "Bauxite" })?.nodeType).toBe("bauxite");
  });

  it("case/whitespace variants of a known NodeType still land on the same camelCase result, via the generic algorithm", () => {
    // Unlike a plain lookup, the generic fallback normalizes case per word, so a variant FRM has
    // never actually been observed sending still produces a sensible, consistent result rather than
    // silently passing through unchanged.
    expect(mapResourceNode({ ...baseNode, NodeType: "fracking satellite" })?.nodeType).toBe("frackingSatellite");
    expect(mapResourceNode({ ...baseNode, NodeType: "NODE" })?.nodeType).toBe("node");
  });

  it("lowercases Purity (Normal/Impure/Pure), never using the separate typo'd EnumPurity field", () => {
    const purities = new Set(
      z
        .array(RawFrmResourceNodeSchema)
        .parse(readCaptureArray(CAPTURE_PATH))
        .map((n) => mapResourceNode(n)?.purity),
    );
    expect([...purities].sort()).toEqual(["impure", "normal", "pure"]);
  });

  it("rounds location x/y (centimetres) to the nearest whole metre", () => {
    const node = mapResourceNode({ ...baseNode, location: { x: 149, y: -151, z: 0 } });
    expect([node?.x, node?.y]).toEqual([1, -2]);
  });

  it("drops a node whose coordinate isn't finite or falls outside +-1,000,000 m, rather than rejecting the whole layer", () => {
    expect(mapResourceNode({ ...baseNode, location: { x: NaN, y: 0, z: 0 } })).toBeUndefined();
    expect(mapResourceNode({ ...baseNode, location: { x: Infinity, y: 0, z: 0 } })).toBeUndefined();
    expect(mapResourceNode({ ...baseNode, location: { x: 100_000_100, y: 0, z: 0 } })).toBeUndefined(); // 1,000,001 m
    const { data, dropped } = mapResourceNodes([
      { ...baseNode, Name: "keep-1" },
      { ...baseNode, Name: "bad", location: { x: NaN, y: 0, z: 0 } },
      { ...baseNode, Name: "keep-2" },
    ]);
    expect(data.map((n) => n.type)).toEqual(["keep-1", "keep-2"]);
    expect(dropped).toBe(1);
  });

  it("keeps a node exactly at the +-1,000,000 m boundary (inclusive, not exclusive)", () => {
    const boundaryCm = 1_000_000 * 100;
    expect(mapResourceNode({ ...baseNode, location: { x: boundaryCm, y: -boundaryCm, z: 0 } })).toMatchObject({ x: 1_000_000, y: -1_000_000 });
  });

  it("keeps FRM's ClassName as className: the real capture's names, by item (ADR-0055 PR 2)", () => {
    const raw = z.array(RawFrmResourceNodeSchema).parse(readCaptureArray(CAPTURE_PATH));
    const pairs = new Set(mapResourceNodes(raw).data.map((n) => `${n.type}=${n.className}`));
    expect([...pairs].sort()).toEqual([
      "Coal=Desc_Coal_C",
      "Crude Oil=Desc_LiquidOil_C",
      "Iron Ore=Desc_OreIron_C",
      "Limestone=Desc_Stone_C",
      "Nitrogen Gas=Desc_NitrogenGas_C",
      "SAM=Desc_SAM_C",
      "Water=Desc_Water_C",
    ]);
  });

  it("omits className (no key) when FRM sent none, empty, or one over the contract's 200-char bound, and the layer still parses", () => {
    const none = mapResourceNode(baseNode);
    expect(none).toBeDefined();
    expect("className" in none!).toBe(false);
    expect("className" in mapResourceNode({ ...baseNode, ClassName: "" })!).toBe(false);
    const tooLong = mapResourceNode({ ...baseNode, ClassName: "D".repeat(201) })!;
    expect("className" in tooLong).toBe(false);
    expect(mapResourceNode({ ...baseNode, ClassName: "D".repeat(200) })?.className).toHaveLength(200);
    expect(ResourceNodesLayerDataSchema.safeParse([none, tooLong]).success).toBe(true);
  });

  it("a non-string ClassName (null, number) must not fail the raw parse: one odd node would otherwise throw the whole layer", () => {
    for (const bad of [null, 5, {}]) {
      expect(z.array(RawFrmResourceNodeSchema).safeParse([{ ...baseNode, ClassName: bad }]).success).toBe(true);
    }
  });

  it("an old stored row without className still parses against the contract", () => {
    const oldRow = { type: "Iron Ore", purity: "pure", nodeType: "node", x: 1, y: 2, exploited: false };
    expect(ResourceNodesLayerDataSchema.safeParse([oldRow]).success).toBe(true);
    expect(ResourceNodesLayerDataSchema.parse([oldRow])[0]).not.toHaveProperty("className");
  });

  it("maps an empty array to an empty array without throwing, and reports 0 dropped", () => {
    expect(mapResourceNodes([])).toEqual({ data: [], dropped: 0 });
  });

  it("maps a large batch (608 items, the full live capture's documented size) without throwing or dropping items", () => {
    const many = Array.from({ length: 608 }, (_, i) => ({ ...baseNode, Name: "Iron Ore", location: { x: i * 100, y: -i * 100, z: 0 } }));
    const { data, dropped } = mapResourceNodes(many);
    expect(data).toHaveLength(608);
    expect(dropped).toBe(0);
    expect(data[607]).toEqual({ type: "Iron Ore", purity: "normal", nodeType: "node", x: 607, y: -607, exploited: false });
  });
});
