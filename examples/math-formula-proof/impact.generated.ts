// Generated from impact.math.md. Edit the math source and regenerate.
import { createJavaScriptRuntime, type StoredJavaScript } from '@cortex-js/compute-engine/runtime';

const runtime = createJavaScriptRuntime();

export const deliveredKWh = runtime.load({
  "code": "(() => { let _tv1 = 0; let i = 1; const _upper = Math.floor((_.d).length); if (!Number.isSafeInteger(_upper)) return NaN; while (i <= _upper) { _tv1 += _SYS.atNumeric(_.d, i, \"real\"); if (_tv1 !== _tv1) return NaN; i++; } return _tv1; })()",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "d"
    ],
    "strings": [
      [
        "d",
        "\"d\" (type `list<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "d": Array<number> }) => number;

export const electricityUsd = runtime.load({
  "code": "(() => { let _tv1 = 0; let i = 1; const _upper = Math.floor((_.s).length); if (!Number.isSafeInteger(_upper)) return NaN; while (i <= _upper) { _tv1 += _SYS.atNumeric(_.s, i, \"real\") * _SYS.atNumeric(_.p, i, \"real\") * _SYS.atNumeric(_.m, i, \"real\"); if (_tv1 !== _tv1) return NaN; i++; } return _tv1; })() / 1000",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "s",
      "p",
      "m"
    ],
    "strings": [
      [
        "s",
        "\"s\" (type `list<real>`)"
      ],
      [
        "p",
        "\"p\" (type `list<real>`)"
      ],
      [
        "m",
        "\"m\" (type `list<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "m": Array<number>; "p": Array<number>; "s": Array<number> }) => number;

export const carbonKg = runtime.load({
  "code": "(() => { let _tv1 = 0; let i = 1; const _upper = Math.floor((_.s).length); if (!Number.isSafeInteger(_upper)) return NaN; while (i <= _upper) { _tv1 += _SYS.atNumeric(_.s, i, \"real\") * _SYS.atNumeric(_.c, i, \"real\"); if (_tv1 !== _tv1) return NaN; i++; } return _tv1; })() / 1000",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "s",
      "c"
    ],
    "strings": [
      [
        "s",
        "\"s\" (type `list<real>`)"
      ],
      [
        "c",
        "\"c\" (type `list<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "c": Array<number>; "s": Array<number> }) => number;
