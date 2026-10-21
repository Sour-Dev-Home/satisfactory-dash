import { describe, expect, it } from "vitest";
import { CONVEYORS_MAX_EDGES, ConveyorsLayerDataSchema } from "@satisfactory-dash/shared";
import { classifyConveyorEnd, mapConveyors } from "./conveyorsMapper.js";

// Records trimmed from docs-vault/raw-sources/captured-responses/frm-get{Belts,Lifts,Pipes}-2026-10-21-*.json (geometry
// removed there already; only the fields the lenient raw schema reads are kept here, plus one stripped extra to show
// that unknown fields are ignored).
const minerBelt = {
  ID: "Build_ConveyorBeltMk1_C_2146994301",
  Name: "Conveyor Belt Mk.1",
  ClassName: "Build_ConveyorBeltMk1_C",
  location0: { x: -55554.97773213777, y: -128606.3612648253, z: 7185.3038151635765 },
  Connected0: true,
  Connected1: true,
  ConnectedTo0: "Build_MinerMk1_C_2147011597",
  ConnectedTo1: "Build_ConveyorAttachmentSplitter_C_2146996403",
  Length: 739.1365356445312,
  ItemsPerMinute: 60,
};
const splitterBelt = {
  ID: "Build_ConveyorBeltMk1_C_2146995466",
  Name: "Conveyor Belt Mk.1",
  location0: { x: -55383.1015625, y: -127763.1796875, z: 6965.5166015625 },
  ConnectedTo0: "Build_ConveyorAttachmentSplitter_C_2146996403",
  ConnectedTo1: "Build_ConstructorMk1_C_2147002363",
  ItemsPerMinute: 60,
};
const mk4IntoMerger = {
  ID: "Build_ConveyorBeltMk4_C_2147211837",
  Name: "Conveyor Belt Mk.4",
  location0: { x: 60200, y: -62999.9999999999, z: 11700.012920865694 },
  ConnectedTo0: "Build_ConveyorAttachmentMerger_C_2147222312",
  ConnectedTo1: "Build_ConveyorAttachmentMerger_C_2147381846",
  ItemsPerMinute: 480,
};
const beltToBelt = {
  ID: "Build_ConveyorBeltMk1_C_2146979166",
  Name: "Conveyor Belt Mk.1",
  location0: { x: -55283.1015625, y: -125998.9453125, z: 6820.4296875 },
  ConnectedTo0: "Build_ConveyorAttachmentMerger_C_2146982118",
  ConnectedTo1: "Build_ConveyorBeltMk1_C_2146977182",
  ItemsPerMinute: 60,
};
const generatorBelt = {
  ID: "Build_ConveyorBeltMk1_C_2146952248",
  Name: "Conveyor Belt Mk.1",
  location0: { x: -54400.00013485551, y: -143200, z: 8299.999823662918 },
  ConnectedTo0: "Build_ConveyorAttachmentSplitter_C_2146955812",
  ConnectedTo1: "Build_GeneratorBiomass_Automated_C_2146972747",
  ItemsPerMinute: 60,
};
const openEnd1Belt = {
  ID: "Build_ConveyorBeltMk1_C_2146953393",
  Name: "Conveyor Belt Mk.1",
  location0: { x: -60000, y: -143100, z: 8300 },
  Connected0: true,
  Connected1: false,
  ConnectedTo0: "Build_ConveyorAttachmentSplitter_C_2146953396",
  ConnectedTo1: "",
  ItemsPerMinute: 60,
};
const lift = {
  ID: "Build_ConveyorLiftMk1_C_2146826510",
  Name: "Conveyor Lift Mk.1",
  location0: { x: -36700, y: -190600, z: 4900.01318359375 },
  ConnectedTo0: "Build_OilRefinery_C_2146845148",
  ConnectedTo1: "Build_ConveyorBeltMk3_C_2146694474",
  ItemsPerMinute: 60,
};
const waterPipe = {
  ID: "Build_Pipeline_C_2147376300",
  Name: "Pipeline Mk.1",
  location0: { x: 9960, y: 3000, z: 23588.11328125 },
  ConnectedTo0: "Build_WaterPump_C_2147439854",
  ConnectedTo1: "Build_PipelineJunction_Cross_C_2147377123",
  Length: 340.2691650390625,
  Speed: 5,
};
const openEnd1Pipe = {
  ID: "Build_Pipeline_C_2146766654",
  Name: "Pipeline Mk.1",
  location0: { x: -37099.99609375, y: -187899.984375, z: 5275 },
  ConnectedTo0: "Build_PipelineJunction_Cross_C_2146766657",
  ConnectedTo1: "",
  Speed: 5,
};
const openEnd0Belt = { ...minerBelt, ID: "Build_ConveyorBeltMk1_C_1", ConnectedTo0: "", ConnectedTo1: "Build_SmelterMk1_C_9" };

const fullCapture = {
  belts: [minerBelt, splitterBelt, mk4IntoMerger, beltToBelt, generatorBelt, openEnd1Belt],
  lifts: [lift],
  pipes: [waterPipe, openEnd1Pipe],
};

describe("mapConveyors", () => {
  it("orients every edge end 0 -> from, end 1 -> to, with the end's kind typed from its id", () => {
    const { data } = mapConveyors({ belts: [minerBelt, generatorBelt], lifts: [], pipes: [] });
    expect(data).toContainEqual({
      id: "Build_ConveyorBeltMk1_C_2146994301",
      kind: "belt",
      from: "Build_MinerMk1_C_2147011597",
      fromKind: "extractor",
      to: "Build_ConveyorAttachmentSplitter_C_2146996403",
      toKind: "splitter",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -556, y: -1286 },
    });
    expect(data).toContainEqual(expect.objectContaining({ id: generatorBelt.ID, fromKind: "splitter", toKind: "consumer" }));
  });

  it("keeps the tier's speed per belt tier and a lift as kind lift", () => {
    const { data } = mapConveyors({ belts: [mk4IntoMerger], lifts: [lift], pipes: [] });
    expect(data.find((e) => e.id === mk4IntoMerger.ID)).toMatchObject({ capacityPerMinute: 480, tier: "Conveyor Belt Mk.4", fromKind: "merger", toKind: "merger" });
    expect(data.find((e) => e.id === lift.ID)).toMatchObject({ kind: "lift", capacityPerMinute: 60, fromKind: "machine", toKind: "conveyor" });
  });

  it("types a belt joined directly to another belt as a conveyor end on both sides", () => {
    const { data } = mapConveyors({ belts: [beltToBelt], lifts: [], pipes: [] });
    expect(data[0]).toMatchObject({ from: "Build_ConveyorAttachmentMerger_C_2146982118", fromKind: "merger", to: "Build_ConveyorBeltMk1_C_2146977182", toKind: "conveyor" });
  });

  it("an open end is null with a null kind, on either side", () => {
    const { data } = mapConveyors({ belts: [openEnd1Belt, openEnd0Belt], lifts: [], pipes: [] });
    expect(data.find((e) => e.id === openEnd1Belt.ID)).toMatchObject({ to: null, toKind: null, from: "Build_ConveyorAttachmentSplitter_C_2146953396", fromKind: "splitter" });
    expect(data.find((e) => e.id === openEnd0Belt.ID)).toMatchObject({ from: null, fromKind: null, to: "Build_SmelterMk1_C_9", toKind: "machine" });
  });

  it("pipes keep both ends as read (the finder adds the arc each way) and get a null capacity, G-B2", () => {
    const { data } = mapConveyors({ belts: [], lifts: [], pipes: [waterPipe, openEnd1Pipe] });
    expect(data).toEqual([
      expect.objectContaining({ id: openEnd1Pipe.ID, kind: "pipe", from: "Build_PipelineJunction_Cross_C_2146766657", fromKind: "junction", to: null, toKind: null, capacityPerMinute: null, tier: "Pipeline Mk.1" }),
      expect.objectContaining({ id: waterPipe.ID, kind: "pipe", from: "Build_WaterPump_C_2147439854", fromKind: "extractor", to: "Build_PipelineJunction_Cross_C_2147377123", toKind: "junction", capacityPerMinute: null, at: { x: 100, y: 30 } }),
    ]);
  });

  it("output is sorted by id and passes the shared contract; geometry and extra fields are gone", () => {
    const { data, dropped, skip } = mapConveyors(fullCapture);
    expect(skip).toBeUndefined();
    expect(dropped).toBe(0);
    expect(data).toHaveLength(9);
    const ids = data.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(() => ConveyorsLayerDataSchema.parse(data)).not.toThrow();
    for (const edge of data) expect(Object.keys(edge).sort()).toEqual(["at", "capacityPerMinute", "from", "fromKind", "id", "kind", "tier", "to", "toKind"]);
  });

  it("the projection is identical however the records are ordered (stable hash)", () => {
    const reversed = { belts: [...fullCapture.belts].reverse(), lifts: [...fullCapture.lifts].reverse(), pipes: [...fullCapture.pipes].reverse() };
    expect(JSON.stringify(mapConveyors(reversed).data)).toBe(JSON.stringify(mapConveyors(fullCapture).data));
  });

  it("rounds end 0's position to whole metres, so sub-metre drift between reads does not change the output", () => {
    const moved = { ...minerBelt, location0: { x: -55554.9, y: -128606.2, z: 0 } };
    expect(mapConveyors({ belts: [moved], lifts: [], pipes: [] }).data).toEqual(mapConveyors({ belts: [minerBelt], lifts: [], pipes: [] }).data);
  });

  describe("the version gate", () => {
    const old = (r: Record<string, unknown>) => {
      const { ConnectedTo0: _a, ConnectedTo1: _b, ...rest } = r;
      return rest;
    };

    it("no record carries ConnectedTo0/ConnectedTo1 (FRM older than 1.5.4): no layer, skip unsupportedFrm", () => {
      const result = mapConveyors({ belts: [old(minerBelt), old(splitterBelt)], lifts: [old(lift)], pipes: [old(waterPipe)] });
      expect(result).toEqual({ data: [], dropped: 0, skip: "unsupportedFrm" });
    });

    it("a record with only one of the two fields does not satisfy the gate", () => {
      const half = { ...old(minerBelt), ConnectedTo0: "Build_MinerMk1_C_1" };
      expect(mapConveyors({ belts: [half], lifts: [], pipes: [] }).skip).toBe("unsupportedFrm");
    });

    it("edge: when other records carry them, one record without is dropped and counted, not a gate failure", () => {
      const result = mapConveyors({ belts: [minerBelt, old(splitterBelt)], lifts: [], pipes: [] });
      expect(result.skip).toBeUndefined();
      expect(result.dropped).toBe(1);
      expect(result.data.map((e) => e.id)).toEqual([minerBelt.ID]);
    });

    it("edge: a factory with no conveyors at all is an empty layer, not a missing-field skip", () => {
      expect(mapConveyors({ belts: [], lifts: [], pipes: [] })).toEqual({ data: [], dropped: 0 });
    });
  });

  describe("dropped records", () => {
    it("counts records that are not the lenient shape (null, no ID, bad position, over-long id) and keeps the rest", () => {
      const result = mapConveyors({
        belts: [minerBelt, null, { ...splitterBelt, ID: "" }, { ...splitterBelt, location0: { x: "1", y: 2 } }, { ...splitterBelt, ID: "x".repeat(129) }, { ...splitterBelt, location0: { x: 1e12, y: 0 } }],
        lifts: [],
        pipes: [],
      });
      expect(result.data.map((e) => e.id)).toEqual([minerBelt.ID]);
      expect(result.dropped).toBe(5);
    });

    it("a missing or negative ItemsPerMinute keeps the edge with a null capacity rather than dropping the connection", () => {
      const { ItemsPerMinute: _speed, ...noSpeed } = splitterBelt;
      const result = mapConveyors({ belts: [noSpeed, { ...minerBelt, ItemsPerMinute: -1 }], lifts: [], pipes: [] });
      expect(result.dropped).toBe(0);
      expect(result.data.map((e) => e.capacityPerMinute)).toEqual([null, null]);
    });
  });

  describe("the edge cap", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...minerBelt, ID: `Build_ConveyorBeltMk1_C_${i}` }));

    it("over CONVEYORS_MAX_EDGES: no layer, skip tooManyEdges", () => {
      const result = mapConveyors({ belts: many(CONVEYORS_MAX_EDGES + 1), lifts: [], pipes: [] });
      expect(result.skip).toBe("tooManyEdges");
      expect(result.data).toEqual([]);
    });

    it("exactly CONVEYORS_MAX_EDGES is still sent", () => {
      const result = mapConveyors({ belts: many(CONVEYORS_MAX_EDGES), lifts: [], pipes: [] });
      expect(result.skip).toBeUndefined();
      expect(result.data).toHaveLength(CONVEYORS_MAX_EDGES);
    });
  });
});

describe("classifyConveyorEnd", () => {
  it.each([
    ["Build_ConveyorAttachmentSplitter_C_1", "splitter"],
    ["Build_ConveyorAttachmentSplitterSmart_C_1", "splitter"],
    ["Build_ConveyorAttachmentSplitterSmartLift_C_1", "splitter"],
    ["Build_ConveyorAttachmentMerger_C_1", "merger"],
    ["Build_ConveyorBeltMk3_C_1", "conveyor"],
    ["Build_ConveyorLiftMk2_C_1", "conveyor"],
    ["Build_Pipeline_C_1", "conveyor"],
    ["Build_PipelineJunction_Cross_C_1", "junction"],
    ["Build_MinerMk2_C_1", "extractor"],
    ["Build_WaterPump_C_1", "extractor"],
    ["Build_GeneratorBiomass_Automated_C_1", "consumer"],
    ["Build_ResourceSink_C_1", "consumer"],
    ["Build_SpaceElevator_C_1", "consumer"],
    ["Build_CentralStorage_C_1", "storage"],
    ["Build_StorageContainerMk2_C_1", "storage"],
    ["Build_TrainDockingStation_C_1", "station"],
    ["Build_AssemblerMk1_C_1", "machine"],
    ["Build_OilRefinery_C_1", "machine"],
    ["Build_SomethingNew_C_1", "other"],
  ])("%s is %s", (id, kind) => {
    expect(classifyConveyorEnd(id)).toBe(kind);
  });
});
