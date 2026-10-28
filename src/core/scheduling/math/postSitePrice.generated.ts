// Generated from postSitePrice.math.md. Edit the math source and regenerate.
import { createJavaScriptRuntime, type StoredJavaScript } from '@cortex-js/compute-engine/runtime';

const runtime = createJavaScriptRuntime();

export const quantitiesMatch = runtime.load({
  "code": "Math.abs(_.actual + -_.expected) <= Math.max(Math.abs(_.actual), Math.abs(_.expected)) * 1.7763568394002505e-15",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "actual",
      "expected"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "actual": number; "expected": number }) => boolean;

export const wholeGpus = runtime.load({
  "code": "((_CND) => _CND === true ? ((() => { const _tv4 = _.availablePowerKW / _.activePowerKWPerGpu; return (Math.sign(_tv4) * Math.round(Math.abs(_tv4))); })()) : _CND === false ? (Math.floor(_.availablePowerKW / _.activePowerKWPerGpu)) : NaN)(((_tv2, _tv3) => Array.isArray(_tv2) || Array.isArray(_tv3) ? _SYS.bcastFn(_fn_quantitiesMatch, _tv2, _tv3) : _fn_quantitiesMatch(_tv2, _tv3))(_.availablePowerKW / _.activePowerKWPerGpu, (() => { const _tv1 = _.availablePowerKW / _.activePowerKWPerGpu; return (Math.sign(_tv1) * Math.round(Math.abs(_tv1))); })()))",
  "preamble": "const _fn_quantitiesMatch = (actual, expected) => Math.abs(actual + -expected) <= Math.max(Math.abs(actual), Math.abs(expected)) * 1.7763568394002505e-15;\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "availablePowerKW",
      "activePowerKWPerGpu"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "activePowerKWPerGpu": number; "availablePowerKW": number }) => number;

export const slotDuration = runtime.load({
  "code": "(_.endMilliseconds + -_.startMilliseconds) / 3600000",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "endMilliseconds",
      "startMilliseconds"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "endMilliseconds": number; "startMilliseconds": number }) => number;

export const concurrentGpus = runtime.load({
  "code": "Math.min(_.capGpus + -_.usedGpus, ((_tv3, _tv4) => Array.isArray(_tv3) || Array.isArray(_tv4) ? _SYS.bcastFn(_fn_wholeGpus, _tv3, _tv4) : _fn_wholeGpus(_tv3, _tv4))(_.activePowerKWPerGpu, _.availablePowerKW))",
  "preamble": "const _fn_quantitiesMatch = (actual, expected) => Math.abs(actual + -expected) <= Math.max(Math.abs(actual), Math.abs(expected)) * 1.7763568394002505e-15;\nconst _fn_wholeGpus = (activePowerKWPerGpu, availablePowerKW) => ((_CND) => _CND === true ? ((() => { const _tv2 = availablePowerKW / activePowerKWPerGpu; return (Math.sign(_tv2) * Math.round(Math.abs(_tv2))); })()) : _CND === false ? (Math.floor(availablePowerKW / activePowerKWPerGpu)) : NaN)(_fn_quantitiesMatch(availablePowerKW / activePowerKWPerGpu, (() => { const _tv1 = availablePowerKW / activePowerKWPerGpu; return (Math.sign(_tv1) * Math.round(Math.abs(_tv1))); })()));\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "capGpus",
      "usedGpus",
      "activePowerKWPerGpu",
      "availablePowerKW"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "activePowerKWPerGpu": number; "availablePowerKW": number; "capGpus": number; "usedGpus": number }) => number;

export const availableWork = runtime.load({
  "code": "Math.min(_.durationHours * _.remainingGpus, _.availableEnergyKWh / _.kWhPerGpuHour)",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "durationHours",
      "remainingGpus",
      "availableEnergyKWh",
      "kWhPerGpuHour"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "availableEnergyKWh": number; "durationHours": number; "kWhPerGpuHour": number; "remainingGpus": number }) => number;

export const usage = runtime.load({
  "code": "[_.kWhPerGpuHour * _.remainingGpuHours, _.activePowerKWPerGpu * _.remainingGpus]",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "kWhPerGpuHour",
      "remainingGpuHours",
      "activePowerKWPerGpu",
      "remainingGpus"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "activePowerKWPerGpu": number; "kWhPerGpuHour": number; "remainingGpuHours": number; "remainingGpus": number }) => [number, number];

export const gridLoad = runtime.load({
  "code": "_.demandMW / _.averageDemandMW",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "demandMW",
      "averageDemandMW"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "averageDemandMW": number; "demandMW": number }) => number;

export const gridEnergyRate = runtime.load({
  "code": "_.usdPerMWh * ((_tv1, _tv2) => Array.isArray(_tv1) || Array.isArray(_tv2) ? _SYS.bcastFn(_fn_gridLoad, _tv1, _tv2) : _fn_gridLoad(_tv1, _tv2))(_.averageDemandMW, _.demandMW)",
  "preamble": "const _fn_gridLoad = (averageDemandMW, demandMW) => demandMW / averageDemandMW;\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "usdPerMWh",
      "averageDemandMW",
      "demandMW"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "averageDemandMW": number; "demandMW": number; "usdPerMWh": number }) => number;

export const sourceCharges = runtime.load({
  "code": "[(_.supplyKWh * _.usdPerMWh) / 1000, (_.gramsCO2PerKWh * _.supplyKWh) / 1000]",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "supplyKWh",
      "usdPerMWh",
      "gramsCO2PerKWh"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "gramsCO2PerKWh": number; "supplyKWh": number; "usdPerMWh": number }) => [number, number];

export const sourceTotal = runtime.load({
  "code": "(() => { let _tv1 = 0; let i = 1; const _upper = Math.floor((_.values).length); if (!Number.isSafeInteger(_upper)) return NaN; while (i <= _upper) { _tv1 += _SYS.atNumeric(_.values, i, \"real\"); if (_tv1 !== _tv1) return NaN; i++; } return _tv1; })()",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "values"
    ],
    "strings": [
      [
        "values",
        "\"values\" (type `list<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "values": Array<number> }) => number;

export const modeledCarbonCharge = runtime.load({
  "code": "(_.carbonKg * _.carbonPriceUsdPerTonne) / 1000",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "carbonKg",
      "carbonPriceUsdPerTonne"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "carbonKg": number; "carbonPriceUsdPerTonne": number }) => number;

export const postedUsdPerGpuHour = runtime.load({
  "code": "(_.carbonChargeUsd + _.electricityUsd) / _.remainingGpuHours",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "carbonChargeUsd",
      "electricityUsd",
      "remainingGpuHours"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "carbonChargeUsd": number; "electricityUsd": number; "remainingGpuHours": number }) => number;

export const publishedLimits = runtime.load({
  "code": "[_.remainingGpus + _.usedGpus, Math.min(_.availablePowerKW, _.requiredPowerKW), Math.min(_.availableEnergyKWh, _.requiredKWh)]",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "remainingGpus",
      "usedGpus",
      "availablePowerKW",
      "requiredPowerKW",
      "availableEnergyKWh",
      "requiredKWh"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "availableEnergyKWh": number; "availablePowerKW": number; "remainingGpus": number; "requiredKWh": number; "requiredPowerKW": number; "usedGpus": number }) => [number, number, number];
