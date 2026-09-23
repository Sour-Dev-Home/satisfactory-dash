import type { PowerCircuit, PowerResponse } from "../src/index";

// Values from the 2026-09-22 captures (docs-vault/raw-sources/captured-responses/
// frm-getPower-2026-09-22-*.json), rounded to 0.1 MW / 0.01 %.
const meta = { serverId: "default", observedAt: "2026-09-22T22:42:39.000Z", stale: false };

/** Main grid, from the F-panel / CJ captures (circuit group 0). */
const mainGrid = {
  circuitGroupId: 0,
  productionMW: 3633.3,
  consumptionMW: 2915.6,
  capacityMW: 4083.3,
  maxConsumptionMW: 4606.5,
  fuseTriggered: false,
  batteryCapacityMWh: 0,
  batteryPercent: 0,
  batteryDifferentialMW: 0,
  status: "ok",
} satisfies PowerCircuit;

/** CJ capture, circuit group 1: fuse tripped, so every reading is 0 except max consumption. */
const trippedGrid = {
  circuitGroupId: 1,
  productionMW: 0,
  consumptionMW: 0,
  capacityMW: 0,
  maxConsumptionMW: 60,
  fuseTriggered: true,
  batteryCapacityMWh: 0,
  batteryPercent: 0,
  batteryDifferentialMW: 0,
  status: "outage",
} satisfies PowerCircuit;

/** H capture: a power switch joined circuits [0, 3]; one 100 MWh battery charging at 100 MW. */
const chargingGrid = {
  ...mainGrid,
  consumptionMW: 2693.3,
  batteryCapacityMWh: 100,
  batteryPercent: 2.33,
  batteryDifferentialMW: 100,
} satisfies PowerCircuit;

/** SYNTHETIC (no capture): consumption above capacity, so the grid is at risk. */
const overloadedGrid = {
  ...mainGrid,
  circuitGroupId: 2,
  productionMW: 400,
  consumptionMW: 450,
  capacityMW: 400,
  maxConsumptionMW: 500,
  status: "at_risk",
} satisfies PowerCircuit;

/** SYNTHETIC (no capture has a discharging battery): 100 MWh at 60 % discharging 80 MW,
 *  which stays ok because the charge is at or above the 20 % at_risk threshold. */
const dischargingGrid = {
  ...mainGrid,
  productionMW: 2800,
  consumptionMW: 2880,
  batteryCapacityMWh: 100,
  batteryPercent: 60,
  batteryDifferentialMW: -80,
  status: "ok",
} satisfies PowerCircuit;

/** SYNTHETIC: draining and below 20 % (12 %), so at_risk, even though consumption is
 *  within capacity. */
const drainingLowGrid = {
  ...mainGrid,
  circuitGroupId: 2,
  productionMW: 300,
  consumptionMW: 380,
  capacityMW: 400,
  maxConsumptionMW: 400,
  batteryCapacityMWh: 100,
  batteryPercent: 12,
  batteryDifferentialMW: -80,
  status: "at_risk",
} satisfies PowerCircuit;

export const powerOk ={ ...meta, data: { circuits: [mainGrid], hasOutage: false } } satisfies PowerResponse;
export const powerOutage = {
  ...meta,
  data: { circuits: [mainGrid, trippedGrid], hasOutage: true },
} satisfies PowerResponse;
export const powerCharging = {
  ...meta,
  data: { circuits: [chargingGrid], hasOutage: false },
} satisfies PowerResponse;
export const powerDischarging = {
  ...meta,
  data: { circuits: [dischargingGrid, drainingLowGrid], hasOutage: false },
} satisfies PowerResponse;
export const powerAtRisk = {
  ...meta,
  data: { circuits: [mainGrid, overloadedGrid], hasOutage: false },
} satisfies PowerResponse;
export const powerEmpty = { ...meta, data: { circuits: [], hasOutage: false } } satisfies PowerResponse;
export const powerStale = {
  ...powerOk,
  observedAt: "2026-09-22T22:30:00.000Z",
  stale: true,
} satisfies PowerResponse;
