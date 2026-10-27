/**
 * The game's display names for the buildings a Planner group can be made of without a `getFactory` record: storage,
 * generators, stations, the depot and the sink, which only the conveyor layer names (by id). Each name is the `Name` FRM
 * gave that class in a committed capture (ground rule 2); a player-named class (a train station, a drone port) is left
 * out, since its `Name` is the player's. A class not listed gets its class spelled out ("Build_ResourceSink_C" is
 * "Resource Sink"): derived, never guessed.
 */
const NAME_BY_CLASS: ReadonlyMap<string, string> = new Map([
  // docs-vault/raw-sources/frm-s4-captures-2026-10-27/frm-getStorageInv-2026-10-27-test3-trimmed.json
  ["Build_StorageContainerMk1_C", "Storage Container"],
  ["Build_StorageContainerMk2_C", "Industrial Storage Container"],
  ["Build_StorageIntegrated_C", "Personal Storage Box"],
  ["Build_StoragePlayer_C", "Personal Storage Box"],
  ["Build_CentralStorage_C", "Dimensional Depot Uploader"],
  // docs-vault/raw-sources/frm-s4-captures-2026-10-27/frm-getGenerators-2026-10-27-test3-trimmed.json
  ["Build_GeneratorBiomass_Automated_C", "Biomass Burner"],
  ["Build_GeneratorIntegratedBiomass_C", "Biomass Burner"],
  ["Build_GeneratorCoal_C", "Coal-Powered Generator"],
  ["Build_GeneratorFuel_C", "Fuel-Powered Generator"],
  ["Build_GeneratorGeoThermal_C", "Geothermal Generator"],
  // docs-vault/raw-sources/captured-responses/frm-getTrainStation-2026-09-27-full.json
  ["Build_TrainDockingStation_C", "Freight Platform"],
  // docs-vault/raw-sources/captured-responses/frm-getTruckStation-2026-10-25-trimmed.json
  ["Build_TruckStation_C", "Truck Station"],
  // docs-vault/raw-sources/captured-responses/frm-getSpaceElevator-2026-09-27-full.json
  ["Build_SpaceElevator_C", "Space Elevator"],
]);

/** A FRM building id is its class and a number ("Build_StorageContainerMk1_C_2147455285"): the class, or null. */
export function classOfId(id: string): string | null {
  const m = /^(Build_[A-Za-z0-9_]+_C)_\d+$/.exec(id);
  return m === null ? null : m[1];
}

/** A building class's display name: the captured one, else the class spelled out ("Build_PipeStorageTank_C" is "Pipe Storage Tank"). */
export function buildingName(className: string): string {
  const known = NAME_BY_CLASS.get(className);
  if (known !== undefined) return known;
  const core = className.replace(/^Build_/, "").replace(/_C$/, "");
  return core
    .split("_")
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter((w) => w !== "")
    .join(" ");
}
