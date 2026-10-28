/** Seeded uniform [0, 1) generator (mulberry32). Same seed, same sequence, on every JS engine. */
export function createRandom(seed: number): () => number {
    if (!Number.isInteger(seed)) throw new RangeError("The seed must be an integer.");
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
