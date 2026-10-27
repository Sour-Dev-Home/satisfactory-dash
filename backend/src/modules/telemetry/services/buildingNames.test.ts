import { describe, expect, it } from "vitest";
import { buildingName, classOfId } from "./buildingNames.js";

describe("classOfId", () => {
  it("reads the class from a FRM building id, and nothing from any other id", () => {
    expect(classOfId("Build_StorageContainerMk1_C_2147455285")).toBe("Build_StorageContainerMk1_C");
    expect(classOfId("Build_GeneratorBiomass_Automated_C_12")).toBe("Build_GeneratorBiomass_Automated_C");
    expect(classOfId("T1")).toBeNull();
    expect(classOfId("Build_StorageContainerMk1_C")).toBeNull();
    expect(classOfId("Persistent_Level:Build_X_C_1")).toBeNull();
    expect(classOfId("")).toBeNull();
  });
});

describe("buildingName", () => {
  it("is the game's own name for a captured class", () => {
    expect(buildingName("Build_StorageContainerMk1_C")).toBe("Storage Container");
    expect(buildingName("Build_StorageContainerMk2_C")).toBe("Industrial Storage Container");
    expect(buildingName("Build_GeneratorCoal_C")).toBe("Coal-Powered Generator");
    expect(buildingName("Build_TrainDockingStation_C")).toBe("Freight Platform");
  });

  it("spells out a class with no captured name, never a guessed one", () => {
    expect(buildingName("Build_ResourceSink_C")).toBe("Resource Sink");
    expect(buildingName("Build_PipeStorageTank_C")).toBe("Pipe Storage Tank");
    expect(buildingName("Build_GeneratorNuclear_C")).toBe("Generator Nuclear");
    expect(buildingName("Build_ConveyorLiftMk3_C")).toBe("Conveyor Lift Mk3");
  });
});
