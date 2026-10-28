// Generated from examples.math.md. Edit the math source and regenerate.
import { createJavaScriptRuntime, type StoredJavaScript } from '@cortex-js/compute-engine/runtime';

const runtime = createJavaScriptRuntime();

export const polynomial = runtime.load({
  "code": "_.a * (_.x * _.x) + _.b * _.x + _.c",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "a",
      "x",
      "b",
      "c"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "a": number; "b": number; "c": number; "x": number }) => number | { re: number; im: number };

export const piecewise = runtime.load({
  "code": "((_.x !== undefined) ? ((0 < _.x) ? ((_.x * _.x)) : ((_.x !== undefined) ? ((_.x < 0) ? (-_.x) : (0)) : NaN)) : NaN)",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "x"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "x": number }) => number | { re: number; im: number };

export const sumSquares = runtime.load({
  "code": "(() => { let _tv1 = 0; let i = 1; const _upper = Math.floor((_.x).length); if (!Number.isSafeInteger(_upper)) return NaN; while (i <= _upper) { _tv1 += _SYS.pow2(_SYS.atNumeric(_.x, i, \"real\")); if (_tv1 !== _tv1) return NaN; i++; } return _tv1; })()",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "x"
    ],
    "strings": [
      [
        "x",
        "\"x\" (type `list<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "x": Array<number> }) => number;

export const withinLimits = runtime.load({
  "code": "_.f <= _.d && _.r <= _.u",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "f",
      "d",
      "r",
      "u"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "d": number; "f": number; "r": number; "u": number }) => boolean;

export const circlePoint = runtime.load({
  "code": "[Math.cos(_.t), Math.sin(_.t)]",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "t"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "t": number }) => [number | { re: number; im: number }, number | { re: number; im: number }];

export const polynomialPlusOne = runtime.load({
  "code": "((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn(_fn_polynomial, 2, 3, 4, _tv1) : _fn_polynomial(2, 3, 4, _tv1))(_.y) + 1",
  "preamble": "const _fn_polynomial = (a, b, c, x) => a * (x * x) + b * x + c;\n",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [
      "y"
    ],
    "complex": [],
    "lists": [],
    "strings": []
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "y": number }) => number | { re: number; im: number };

export const transposeMatrix = runtime.load({
  "code": "_SYS.transpose(_.A)",
  "calling": "expression",
  "reconstructionDigits": 17,
  "entryPlan": {
    "kind": "vars",
    "real": [],
    "complex": [],
    "lists": [
      "A"
    ],
    "strings": [
      [
        "A",
        "\"A\" (type `matrix<real>`)"
      ]
    ]
  },
  "runtimeVersion": "0.171.0"
} satisfies StoredJavaScript) as
  (input: { "A": Array<Array<number>> }) => Array<Array<number>>;
