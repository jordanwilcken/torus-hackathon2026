# Math to TypeScript proof

Use the repository's Node version. Preview either math document in VS Code with **Ctrl+K, then V**.

From the repository root, install once:

```sh
npm --prefix examples/math-formula-proof ci
```

Then:

```sh
npm run generate:math
npm run test:math
```

Every `*.math.md` in this folder generates a matching `*.generated.ts`. To select a different source/output, run `node generate.mjs input.md output.ts` from this folder.

Write an expression in a `$$` block. Cortex infers its inputs; the nearest Markdown heading supplies the export name (`## Sales tax` becomes `salesTax`). Without a heading, the filename supplies the name (`polynomial.math.md` becomes `polynomial`). Use distinct headings for multiple functions and avoid built-in names such as `sin`. Earlier functions in the same document can be called with `\operatorname{functionName}(...)`, with arguments in alphabetical input-name order. TypeScript exports accept named input objects.

JSON is optional. Immediately before a math block, it can override `name` or give partial `inputs` hints; remaining inputs are inferred. Indexed notation such as `x_i` needs an array hint (`{"inputs":{"x":"list<real>"}}`), while explicit `\operatorname{At}(x,i)` can infer indexing. Matrices also benefit from shape hints. Built-in constants such as `e` stay constants unless explicitly overridden. Hints apply only to the next math block.

An optional `result` hint (for example `{"result":"real"}`) uses Cortex's checked `Typed` expression to narrow the generated return type. Incompatible complex-as-real calculations fail compilation.

See [examples.math.md](examples.math.md) for polynomials, piecewise functions, arrays/sums, boolean constraints, tuples, composition and matrices. [impact.math.md](impact.math.md) uses the identical generator for energy totals.

```ts
import { polynomial, sumSquares } from './examples.generated.ts';

polynomial({ a: 2, b: 3, c: 4, x: 5 }); // 69
sumSquares({ x: [2, 3, 4] });           // 29
```

Generated modules contain compiled JavaScript and import Cortex's pinned runtime helpers. They do not parse or symbolically evaluate math. The runtime reconstructs compiled functions dynamically, which requires a compatible content security policy. They are not standalone arithmetic-only TypeScript.

Compilation uses Cortex's strict numeric mode and fails for unsupported expressions. Each math block is a function body, not a root `\mapsto` lambda. Common scalar/list/matrix/tuple types are emitted; ambiguous result types remain conservative (including possible complex values), and other representations remain `unknown`. Units are documented, not checked. Boolean constraints are predicates, not an optimization solver.

This proof is independent of the application and is not included in its build or scorecard.
