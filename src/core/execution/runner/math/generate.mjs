import { readFile, writeFile } from "node:fs/promises";
import { compileMath } from "../../../energy/site/math/generate.mjs";

// Reuse the existing pinned strict scalar emitter; no second compiler or runtime.
async function generate() {
    if (process.argv.slice(2).some(argument => argument !== "--check"))
        throw new Error("Usage: node src/core/execution/runner/math/generate.mjs [--check]");
    const check = process.argv.includes("--check");
    for (const name of ["time", "execution", "transfer"]) {
        const source = new URL(`./${name}.math.md`, import.meta.url);
        const target = new URL(`./${name}.generated.js`, import.meta.url);
        const generated = compileMath(await readFile(source, "utf8"), `${name}.math.md`);
        if (check) {
            const current = await readFile(target, "utf8");
            if (current.replace(/\r\n/g, "\n") !== generated)
                throw new Error(`${name}.generated.js is stale; run npm run generate:execution-math.`);
        } else await writeFile(target, generated, "utf8");
    }
    console.log(check ? "Runner math is current." : "Generated runner math JavaScript.");
}

try { await generate(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
