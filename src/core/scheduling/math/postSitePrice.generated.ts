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

export const gpuHoursForEnergy = runtime.load({
  "code": "_.availableEnergyKWh / _.kWhPerGpuHour",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "availableEnergyKWh",
      "kWhPerGpuHour"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "availableEnergyKWh": number; "kWhPerGpuHour": number }) => number;
