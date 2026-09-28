import type {
  RawHealthCheckResponse,
  RawQueryServerStateResponse,
  RawFrmFactoryBuilding,
  RawFrmPowerCircuit,
  RawFrmPowerUsageBuilding,
  RawFrmSessionInfo,
  RawFrmTrainRail,
  RawFrmResourceNode,
} from "../src/rawTypes.js";

/**
 * Fixture data for adapter/client tests. Real captured responses are copied
 * verbatim from docs-vault/raw-sources/captured-responses/; the rest are the
 * documented example responses from the corresponding
 * docs-vault/raw-sources/frm-get*.md pages (schema-confirmed, not yet live-verified
 * with real buildings — see docs-vault/wiki/data-gap-analysis.md).
 */

// Real capture: docs-vault/raw-sources/captured-responses/vanilla-QueryServerState-sample.json
export const queryServerStateFixture: RawQueryServerStateResponse = {
  serverGameState: {
    activeSessionName: "docs-vault-spike",
    numConnectedPlayers: 0,
    playerLimit: 4,
    techTier: 2,
    activeSchematic: "None",
    gamePhase: "/Script/FactoryGame.FGGamePhase'/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_0.GP_Project_Assembly_Phase_0'",
    isGameRunning: true,
    totalGameDuration: 29,
    isGamePaused: false,
    averageTickRate: 29.885358810424805,
    autoLoadSessionName: "docs-vault-spike",
    agreeToCrashUploadRequested: false,
  },
};

// Real capture: HealthCheck was hit live during the spike (see docs-vault/wiki/log.md)
// returning {"data":{"health":"healthy","serverCustomData":""}}.
export const healthCheckFixture: RawHealthCheckResponse = {
  health: "healthy",
  serverCustomData: "",
};

// Real capture: docs-vault/raw-sources/captured-responses/frm-getSessionInfo-sample.json
export const sessionInfoFixture: RawFrmSessionInfo = {
  SessionName: "docs-vault-spike",
  IsPaused: false,
  DayLength: 50,
  NightLength: 10,
  PassedDays: 0,
  IsDay: true,
  TotalPlayDuration: 29,
};

// Documented example: docs-vault/raw-sources/frm-getFactory.md
export const factoryBuildingFixture: RawFrmFactoryBuilding = {
  ID: "Build_ConstructorMk1_C_2147415548",
  Name: "Constructor",
  ClassName: "Build_ConstructorMk1_C",
  Recipe: "Concrete",
  production: [
    { Name: "Concrete", ClassName: "Desc_Cement_C", Amount: 33, CurrentProd: 0, MaxProd: 1.649999976158142, ProdPercent: 0 },
  ],
  ingredients: [
    { Name: "Limestone", ClassName: "Desc_Stone_C", Amount: 1, CurrentConsumed: 0, MaxConsumed: 4.949999809265137, ConsPercent: 0 },
  ],
  OutputInventory: [{ Name: "Concrete", ClassName: "Desc_Cement_C", Amount: 100, MaxAmount: 100 }],
  IsProducing: false,
  IsPaused: true,
  PowerInfo: { CircuitGroupID: 0, CircuitID: 1, PowerConsumed: 0.10000000149011612, MaxPowerConsumed: 0.21619677543640137 },
};

// Documented example: docs-vault/raw-sources/frm-getPower.md
export const powerCircuitFixture: RawFrmPowerCircuit = {
  CircuitGroupID: 0,
  PowerProduction: 0,
  PowerConsumed: 0,
  PowerCapacity: 0,
  PowerMaxConsumed: 100,
  BatteryDifferential: 0,
  BatteryPercent: 0,
  BatteryCapacity: 0,
  FuseTriggered: false,
};

// Documented example: docs-vault/raw-sources/frm-getPowerUsage.md
export const powerUsageBuildingFixture: RawFrmPowerUsageBuilding = {
  ID: "Build_OilRefinery_C_2147345255",
  Name: "Refinery",
  ClassName: "Build_OilRefinery_C",
  PowerInfo: { CircuitGroupID: -1, CircuitID: -1, FuseTriggered: false, PowerConsumed: 0, MaxPowerConsumed: 0 },
};

// Documented example: docs-vault/raw-sources/frm-getPlayer.md. Deliberately NOT typed as
// RawFrmPlayer (which declares only Name and Online): it is what FRM really sends, so tests can
// prove the extra fields are dropped at the boundary (ADR-0029).
export const playerFixture = {
  ID: "Char_Player_C_2147452680",
  Name: "derpierre65",
  location: { x: -57604.6796875, y: 260436.1875, z: -3018.36083984375, rotation: 115.5536737696151 },
  Online: true,
  PlayerHP: 100,
  Dead: false,
};

// Real capture: docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json,
// the shorter of the two trimmed segments (17 spline points).
export const trainRailFixture: RawFrmTrainRail = {
  ID: "Build_RailroadTrack_C_2147304732",
  SplineData: [
    { x: -111900, y: -150400 }, { x: -111827.58079429774, y: -150400 }, { x: -111754.80246639732, y: -150400 },
    { x: -111682.02742033168, y: -150400 }, { x: -111609.30488775825, y: -150400 }, { x: -111536.40248749494, y: -150400 },
    { x: -111463.64841158094, y: -150400 }, { x: -111390.78347491259, y: -150400 }, { x: -111317.94462871869, y: -150400 },
    { x: -111245.08165218907, y: -150400 }, { x: -111172.27148772354, y: -150400 }, { x: -111099.39619405456, y: -150400 },
    { x: -111026.5777148786, y: -150400 }, { x: -110953.82986631832, y: -150400 }, { x: -110880.96652673393, y: -150400 },
    { x: -110808.37622046052, y: -150400 }, { x: -110735.56460883941, y: -150400 },
  ],
};

// Real capture: docs-vault/raw-sources/captured-responses/frm-getResourceNode-2026-09-27-trimmed.json, item 1.
export const resourceNodeFixture: RawFrmResourceNode = {
  Name: "Crude Oil",
  Purity: "Normal",
  NodeType: "Node",
  Exploited: false,
  location: { x: 178265.375, y: 206095.640625, z: -9238.5712890625, rotation: 123.25028610229492 },
};
