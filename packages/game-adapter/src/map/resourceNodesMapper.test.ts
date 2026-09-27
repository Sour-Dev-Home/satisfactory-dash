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
});
