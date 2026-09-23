import type {
  RawHealthCheckResponse,
  RawQueryServerStateResponse,
  RawFrmFactoryBuilding,
  RawFrmPowerCircuit,
  RawFrmPowerUsageBuilding,
  RawFrmPlayer,
  RawFrmSessionInfo,
} from "../rawTypes.js";

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

// Documented example: docs-vault/raw-sources/frm-getPlayer.md
export const playerFixture: RawFrmPlayer = {
  ID: "Char_Player_C_2147452680",
  Name: "derpierre65",
  location: { x: -57604.6796875, y: 260436.1875, z: -3018.36083984375, rotation: 115.5536737696151 },
  Online: true,
  PlayerHP: 100,
  Dead: false,
};
