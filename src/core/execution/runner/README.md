# Simulated allocation execution

`createExecutor` implements the existing `Executor` operations over the shared site-energy ledger. It models checkpointable work; it does not launch a local process or migrate a real worker.

```ts
const runner = createExecutor({
    jobs,
    sites: [{ locationId: "A", computeProfile: "gpu", kWhPerGpuHour: 0.85,
        accountingBasis, ledger: siteA }, { locationId: "B", computeProfile: "gpu",
        kWhPerGpuHour: 0.85, accountingBasis, ledger: siteB }],
    maximumAgeMinutes: 5,
    transferTerms: (from, to, startsAt) => suppliedTransferTerms(from, to, startsAt),
});

// The chooser supplies a current selection. Acceptance reserves capacity but completes no work.
if (selection.selected && runner.accept(selection)) {
    const observation = runner.tick(currentHour);
    showExecutionsAndMeters(observation);
}

// A movement policy chooses B. The runner performs the requested transfer.
const transfer = runner.move(runner.job("batch")!, "B", nextHour.startAt);
// Record transfer.evidence once by its stable ID, separately from tick meters.
// Tick through transit; then read runner.job("batch") and choose/accept a fresh destination slot.
```

The caller supplies one fixed canonical tick grid shared by all ledgers, with an unsettled initial tick. The runner captures its input jobs and owns their state. `job(id)` returns a detached snapshot including location, transfer destination, readiness and remaining work. Source job objects and returned receipts can be mutated without changing the runner.

Each site has one declared compute profile and accounting basis matching its ledger configuration. The runner exclusively owns reservation and dispatch commands on those ledgers. Input updates and quote refreshes remain external so events can invalidate availability before execution. Use separate ledgers and runners for separate comparison arms.

## Acceptance and ticks

Acceptance checks the current publication, freshness, version, price/basis, profile, job eligibility and allocation quantities, then reserves one site's current slot atomically. Remote selection requires an explicit move first, even for a zero-duration move. A current tick may reserve only the interval after readiness and before the deadline. The remaining work at the selected GPU count must fit a whole number of milliseconds (allowing binary64 roundoff); otherwise acceptance fails before reserving or completing any work. This explicit timestamp-resolution limit prevents a fractional final remainder from becoming stranded or being silently rounded away.

Actual loads end when the remaining work finishes. Compute energy comes from the ledger's actual usage; posted charges use actual GPU-hours. Whole-site meters include fixed/idle load and retain unknown carbon/cost. The ledger owns physical dispatch, storage losses, reserve limits and accounting, including PUE already present in the supplied compute profile.

Each hour requires a fresh allocation. An accepted load that becomes infeasible pauses without losing its checkpoint. The runner then tries the site's idle load. A fixed-load or reserve infeasibility marks the whole observation infeasible and stops further ticks until the run is reconstructed. Settlement is atomic per site, not across the fleet: other sites may already have settled, and their meters/work remain in the receipt. Provider exceptions propagate; reconstruct after an unexpected provider error rather than attempting a partially completed command again.

An exact tick retry returns a detached copy of the original receipt without calling the ledgers. Overlap, skipped hours and out-of-order windows are rejected without mutation. Acceptance receipts acknowledge the original command on retry, including after settlement or release; they do not recreate reservations. A changed command using the same job/slot/version is rejected.

## Transfers

Moves require the runner's current job snapshot, an allowed explicit destination with the same profile, declared compatible terms, and enough known time/capacity before the deadline. Missing terms reject; missing carbon or electricity rates stay unknown. Transfer energy is `dataGB * kWhPerGB`, duration is `dataGB / bandwidthGBPerHour`, and readiness rounds upward to the next canonical tick. Future destination capacity is checked but never reserved.

A successful move releases its source reservation, retains remaining work, and books one stable transfer receipt at the start. Moving jobs complete no work. At arrival the job becomes queued at the destination and needs a new current slot. A zero-data move may arrive immediately. Retried moves return the same receipt without repeating charges or changing progress.

## Integration boundary

Automatic destination selection, actual process execution and application wiring are separate tasks. The existing simulation clock currently copies only `remainingGpuH` and `state` from execution observations. Integration must also consume the runner's authoritative `currentLocation`, `transferToLocation` and `readyAt` snapshots before subsequent routing. The runner does not edit clock state or install a second clock.

The original partial-final-tick acceptance example and the scoped runner examples use the real chooser/ledger or explicit caller-supplied selections. They do not use recorded reporting evidence as execution.

## Authored math

All runner formulas live in [math/execution.math.md](math/execution.math.md),
[math/transfer.math.md](math/transfer.math.md) and [math/time.math.md](math/time.math.md).
Edit those equations, then run `npm run generate:execution-math`; ordinary builds
also regenerate them. `npm run check:execution-math` detects stale output.
The runner imports the committed standalone `.generated.js` files, with no math
runtime. The existing site-energy scalar emitter is reused unchanged at build time.
Parsing, evidence checks, reservations, receipts and job-state transitions stay in
TypeScript. Formula boundaries preserve binary64 evaluation order and the existing
whole-millisecond acceptance contract.
