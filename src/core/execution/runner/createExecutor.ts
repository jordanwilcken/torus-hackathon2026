import type { ExecutorInputs, ExecutionRunner } from "./Executor.types.js";
import type { Job } from "../../jobs/Job.type.js";
import type { TimeWindow } from "../../TimeWindow.type.js";
import type { TickObservation } from "../TickObservation.type.js";
import type { StartedTransfer, TransferOutcome } from "../TransferOutcome.type.js";
import { allocationKey, allocationSignature, prepareAllocation, type AcceptedAllocation } from "./acceptAllocation.js";
import { prepareTransfer } from "./prepareTransfer.js";
import { bounds, sameWindow, windowAt } from "./executionTime.js";
import { dispatchSiteTick, applyAllocationUsage, type CompletedWork } from "./settleSite.js";
import * as time from "./math/time.generated.js";

/** A labeled simulation runner over exclusively owned real ledgers, never a hardware worker.
 * Every site settles independently. Idle infeasibility stops this run; receipts preserve any
 * other sites already settled. Reconstruct the run to recover; there is no fleet rollback.
 */
export function createExecutor(inputs: ExecutorInputs): ExecutionRunner {
    const sites = inputs.sites.map(site => ({ ...site }));
    const initial = sites[0]?.ledger.state().nextWindow, interval = bounds(initial);
    if (!interval || !Number.isFinite(inputs.maximumAgeMinutes) || inputs.maximumAgeMinutes < 0 ||
        new Set(sites.map(s => s.locationId)).size !== sites.length || new Set(sites.map(s => s.ledger)).size !== sites.length ||
        sites.some(s => !s.locationId || !s.computeProfile || !s.accountingBasis ||
            !Number.isFinite(s.kWhPerGpuHour) || s.kWhPerGpuHour <= 0 || !sameWindow(s.ledger.state().nextWindow, initial!)))
        throw new RangeError("Execution needs unique sites on the same canonical tick, declared profiles and a freshness limit.");
    const jobs = new Map<string, Job>();
    for (const supplied of inputs.jobs) {
        const job = structuredClone(supplied);
        validateJob(job);
        if (jobs.has(job.id) || !sites.some(s => s.locationId === job.currentLocation))
            throw new RangeError("Jobs require unique IDs and a known current site.");
        jobs.set(job.id, job);
    }
    const maximumAgeMinutes = inputs.maximumAgeMinutes, transferTerms = inputs.transferTerms;
    const grid = { origin: interval[0], duration: time.elapsedMilliseconds({ start: interval[0], end: interval[1] }) };
    let nextStart = grid.origin, stopped = false;
    const currentWindow = (): TimeWindow => windowAt(nextStart, time.timeAfter({ start: nextStart, durationMs: grid.duration }));
    const active = new Map<string, AcceptedAllocation>();
    const arrived = new Set<string>();
    const admissionTime = new Map([...jobs.values()].map(job => [job.id,
        time.readyTime({ windowStart: Date.parse(job.window.startAt), readyAt: Date.parse(job.readyAt) })]));
    const accepted = new Map<string, string>();
    const ticks = new Map<string, TickObservation>();
    const transfers = new Map<string, { request: string; result: StartedTransfer }>();
    const failure = (explanation: string): TickObservation => ({ feasible: false, executions: [], meters: [], explanation });

    return {
        job: id => structuredClone(jobs.get(id)),
        accept(selection): boolean {
            const key = allocationKey(selection), signature = allocationSignature(selection);
            // A receipt acknowledges the original command; it never recreates a consumed/released reservation.
            if (accepted.has(key)) return accepted.get(key) === signature;
            const job = jobs.get(selection.allocation.jobId), site = sites.find(s => s.locationId === selection.allocation.slot.locationId);
            if (stopped || !job || !site || active.has(job.id) || !sameWindow(site.ledger.state().nextWindow, currentWindow())) return false;
            const prepared = prepareAllocation(selection, job, site, currentWindow(), maximumAgeMinutes);
            if (!prepared || !site.ledger.reserve({ version: selection.allocation.slotVersion, load: prepared.load }).accepted) return false;
            active.set(job.id, prepared);
            accepted.set(key, signature);
            job.state = "running";
            return true;
        },
        tick(window): TickObservation {
            const requested = bounds(window);
            if (!requested) return failure("Ticks require valid timestamps and positive duration.");
            const key = requested.join("/");
            const retry = ticks.get(key);
            if (retry) return structuredClone(retry);
            if (stopped) return failure("This run stopped on infeasible site supply; reconstruct it before continuing.");
            if (!sameWindow(window, currentWindow()) || sites.some(s => !sameWindow(s.ledger.state().nextWindow, window)))
                return failure("Ticks must follow the shared canonical chronological grid without gaps or overlap.");
            const [start, end] = requested;
            for (const job of jobs.values()) {
                if (admissionTime.get(job.id)! < end) arrived.add(job.id);
            }
            for (const job of jobs.values()) arrive(job, start);
            const progress = new Map<string, CompletedWork>();
            const observation: TickObservation = { feasible: true, executions: [], meters: [] };
            const explanations: string[] = [];
            // Exceptions can occur after a prior site settled. Fail closed until a complete receipt is captured.
            stopped = true;
            for (const site of sites) {
                const allocations = [...active.values()].filter(a => a.site === site);
                const loads = allocations.filter(a => jobs.get(a.jobId)!.state === "running").map(a => a.load);
                const settlement = dispatchSiteTick(site, window, loads);
                if (!settlement.result.feasible) observation.feasible = false;
                observation.meters.push(...settlement.result.meters);
                explanations.push(...settlement.explanations);
                for (const allocation of allocations) {
                    const job = jobs.get(allocation.jobId)!;
                    if (settlement.computeExecuted && job.state === "running") {
                        const usage = settlement.result.usage[allocation.load.id];
                        progress.set(job.id, applyAllocationUsage(job, allocation, usage));
                    } else if (job.state === "running") job.state = "paused";
                    active.delete(job.id);
                }
            }
            for (const job of jobs.values()) {
                if (!arrived.has(job.id)) continue;
                arrive(job, end);
                if (job.state === "running" && !progress.has(job.id)) job.state = "queued";
                if (job.state !== "done" && job.remainingGpuH > 0 && Date.parse(job.window.endAt) <= end) job.state = "missed";
                observation.executions.push({ jobId: job.id, locationId: job.currentLocation, window: { ...window },
                    completedGpuH: 0, computeKWh: 0, postedChargeUsd: 0, ...progress.get(job.id),
                    remainingGpuH: job.remainingGpuH, state: job.state });
            }
            if (explanations.length) observation.explanation = explanations.join(" ");
            stopped = !observation.feasible;
            nextStart = end;
            ticks.set(key, structuredClone(observation));
            return structuredClone(observation);
        },
        move(request, destination, startsAt): TransferOutcome {
            const reject = (explanation: string): TransferOutcome => ({ started: false, explanation });
            const start = Date.parse(startsAt);
            const key = JSON.stringify([request.id, destination, start]);
            const requestSignature = jobSignature(request);
            const job = jobs.get(request.id), prior = transfers.get(key);
            const matchesCurrentSnapshot = job !== undefined && jobSignature(job) === requestSignature;
            if (prior) {
                const matchesOriginalRequest = prior.request === requestSignature;
                return matchesOriginalRequest || matchesCurrentSnapshot
                    ? structuredClone(prior.result) : reject("Transfer retry changed the job's inputs.");
            }
            const site = sites.find(s => s.locationId === destination);
            if (stopped || !job || !matchesCurrentSnapshot) return reject("Use the runner's current job snapshot.");
            if (!site || !job.allowedLocations.includes(destination) || destination === job.currentLocation ||
                site.computeProfile !== job.computeProfile || !["queued", "running", "paused"].includes(job.state) || job.remainingGpuH <= 0 ||
                start !== nextStart || nextStart < time.readyTime({ readyAt: Date.parse(job.readyAt), windowStart: Date.parse(job.window.startAt) }) ||
                !sameWindow(site.ledger.state().nextWindow, currentWindow())) return reject("The job, destination or transfer start is not eligible.");
            const terms = transferTerms(job.currentLocation, destination, startsAt);
            const source = sites.find(s => s.locationId === job.currentLocation)!;
            if (!terms || terms.accountingBasis !== source.accountingBasis) return reject("Compatible transfer terms are unavailable.");
            const result = prepareTransfer(job, site, startsAt, terms, grid, maximumAgeMinutes);
            if (!result.started) return result;
            const reservation = active.get(job.id);
            if (reservation && !reservation.site.ledger.release(reservation.load.id)) return reject("The existing reservation could not be released.");
            active.delete(job.id);
            transfers.set(key, { request: requestSignature, result: structuredClone(result) });
            arrived.add(job.id);
            job.state = "moving";
            job.transferToLocation = destination;
            job.readyAt = result.readyAt;
            arrive(job, nextStart);
            return structuredClone(result);
        },
    };
}

function arrive(job: Job, at: number): void {
    if (job.state !== "moving" || Date.parse(job.readyAt) > at) return;
    job.currentLocation = job.transferToLocation!;
    delete job.transferToLocation;
    job.state = "queued";
}

function jobSignature(job: Job): string {
    return JSON.stringify([job.id, job.workloadRef, job.computeProfile, job.window.startAt, job.window.endAt,
        job.allowedLocations, job.homeLocation, job.currentLocation, job.transferToLocation, job.readyAt,
        job.workGpuH, job.remainingGpuH, job.maxGpus, job.dataGB, job.state]);
}

function validateJob(job: Job): void {
    if (!job.id || !job.workloadRef || !job.computeProfile || !bounds(job.window) || !Number.isFinite(Date.parse(job.readyAt)) ||
        !job.allowedLocations.length || !job.homeLocation || !job.currentLocation ||
        !Number.isInteger(job.maxGpus) || job.maxGpus <= 0 ||
        [job.workGpuH, job.remainingGpuH, job.dataGB].some(n => !Number.isFinite(n) || n < 0) || job.remainingGpuH > job.workGpuH ||
        !["queued", "running", "paused", "moving", "done", "missed"].includes(job.state) ||
        job.state === "moving" && (!job.transferToLocation || !job.allowedLocations.includes(job.transferToLocation)))
        throw new RangeError("Jobs require valid identities, times, work, GPU limits and transfer state.");
}
