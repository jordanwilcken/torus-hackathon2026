// Generated from chooseExecutionSlot.math.md. Edit the math source and regenerate.
import { createJavaScriptRuntime, type StoredJavaScript } from '@cortex-js/compute-engine/runtime';

const runtime = createJavaScriptRuntime();

export const roundoff = runtime.load({
  "code": "_.value * 2.220446049250313e-16",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "value"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "value": number }) => number;

export const floorWholeUnits = runtime.load({
  "code": "Math.floor(_.value + 4 * ((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn(_fn_roundoff, _tv1) : _fn_roundoff(_tv1))(Math.abs(_.value)))",
  "preamble": "const _fn_roundoff = (value) => value * 2.220446049250313e-16;\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "value"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "value": number }) => number;

export const exceeds = runtime.load({
  "code": "4 * ((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn(_fn_roundoff, _tv1) : _fn_roundoff(_tv1))(Math.max(Math.abs(_.value), Math.abs(_.limit))) < -_.limit + _.value",
  "preamble": "const _fn_roundoff = (value) => value * 2.220446049250313e-16;\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "value",
      "limit"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "limit": number; "value": number }) => boolean;

export const minimumRunHours = runtime.load({
  "code": "_.remainingGpuH / _.maxGpus",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "remainingGpuH",
      "maxGpus"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "maxGpus": number; "remainingGpuH": number }) => number;

export const powerLimitedGpus = runtime.load({
  "code": "Math.min(_.maxGpus, _.capGpus + -_.usedGpus, ((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn(_fn_floorWholeUnits, _tv1) : _fn_floorWholeUnits(_tv1))(_.availablePowerKW / _.kWhPerGpuHour), Math.ceil(_.remainingGpuH / _.durationHours))",
  "preamble": "const _fn_roundoff = (value) => value * 2.220446049250313e-16;\nconst _fn_floorWholeUnits = (value) => Math.floor(value + 4 * _fn_roundoff(Math.abs(value)));\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "maxGpus",
      "capGpus",
      "usedGpus",
      "availablePowerKW",
      "kWhPerGpuHour",
      "remainingGpuH",
      "durationHours"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "availablePowerKW": number; "capGpus": number; "durationHours": number; "kWhPerGpuHour": number; "maxGpus": number; "remainingGpuH": number; "usedGpus": number }) => number;

export const energyLimitedGpus = runtime.load({
  "code": "((_CND) => _CND === true ? (Math.min(_.initialGpus, ((_tv3) => Array.isArray(_tv3) ? _SYS.bcastFn(_fn_floorWholeUnits, _tv3) : _fn_floorWholeUnits(_tv3))(_.availableEnergyKWh / (_.durationHours * _.kWhPerGpuHour)))) : _CND === false ? (_.initialGpus) : NaN)(((_tv1, _tv2) => Array.isArray(_tv1) || Array.isArray(_tv2) ? _SYS.bcastFn(_fn_exceeds, _tv1, _tv2) : _fn_exceeds(_tv1, _tv2))(_.availableEnergyKWh, _.kWhPerGpuHour * Math.min(_.remainingGpuH, _.durationHours * _.initialGpus)))",
  "preamble": "const _fn_roundoff = (value) => value * 2.220446049250313e-16;\nconst _fn_exceeds = (limit, value) => 4 * _fn_roundoff(Math.max(Math.abs(value), Math.abs(limit))) < -limit + value;\nconst _fn_floorWholeUnits = (value) => Math.floor(value + 4 * _fn_roundoff(Math.abs(value)));\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "availableEnergyKWh",
      "kWhPerGpuHour",
      "remainingGpuH",
      "durationHours",
      "initialGpus"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "availableEnergyKWh": number; "durationHours": number; "initialGpus": number; "kWhPerGpuHour": number; "remainingGpuH": number }) => number;

export const slotUsage = runtime.load({
  "code": "(() => { const _cse1 = Math.min(_.remainingGpuH, _.allocatedGpus * _.durationHours); return [_cse1, _.allocatedGpus * _.kWhPerGpuHour, _.kWhPerGpuHour * _cse1]; })()",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "remainingGpuH",
      "allocatedGpus",
      "durationHours",
      "kWhPerGpuHour"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "allocatedGpus": number; "durationHours": number; "kWhPerGpuHour": number; "remainingGpuH": number }) => [number, number, number];

export const priceWithTransfer = runtime.load({
  "code": "_.postedUsdPerGpuHour + _.transferCostUsd / _.remainingGpuH",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "postedUsdPerGpuHour",
      "transferCostUsd",
      "remainingGpuH"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "postedUsdPerGpuHour": number; "remainingGpuH": number; "transferCostUsd": number }) => number;
