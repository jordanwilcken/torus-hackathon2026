import type { Job } from "../../jobs/Job.type.js";
import type { JobOutcome } from "../JobOutcome.type.js";
import type { Router } from "../Router.interface.js";
import { route } from "../route.js";
import { fakeEnergyMap } from "../../energy/fakes/fakeEnergyMap.js";

/** Fixed Fake selection; reads sample energy but does not reserve or execute. */
export const fakeRouter = {
    async route(job: Job): Promise<JobOutcome & { fake: true; label: string }> {
        const label = "Fake routing outcome — fixed one-GPU-hour selection; no work has executed.";
        const unsupported = { fake: true as const, label, selected: false as const,
            explanation: "This Fake only supports the fake-job fixture; real routing is not implemented." };
        if (job.id !== "fake-job" || job.computeProfile !== "fake-1kWh-per-GPUh" ||
            job.workGpuH !== 1 || job.remainingGpuH !== 1 || job.maxGpus < 1 || job.state !== "queued")
            return unsupported;
        const reference = fakeEnergyMap.findSlots({
            window: job.window, asOf: job.readyAt, locations: job.allowedLocations, computeProfile: job.computeProfile,
        }).find(slot => slot.locationId === "fake-utah-solar" && slot.locationId === job.currentLocation);
        if (!reference) return unsupported;
        const snapshot = fakeEnergyMap.readSlot(reference, job.readyAt, 5);
        const slot = snapshot.slot;
        if (snapshot.status !== "current" || !slot || !snapshot.version ||
            job.readyAt !== slot.window.startAt || job.window.startAt !== slot.window.startAt || job.window.endAt !== slot.window.endAt)
            return unsupported;
        return {
            fake: true, label, selected: true,
            allocation: {
                jobId: job.id, slot: reference, slotVersion: snapshot.version,
                allocatedGpus: 1, kWhPerGpuHour: 1, requiredPowerKW: 1,
                energy: [{ window: { ...slot.window }, estimatedKWh: 1 }],
                forecast: fakeEnergyMap.readForecast(reference, job.readyAt),
                postedUsdPerGpuHour: slot.postedUsdPerGpuHour, priceBasis: slot.priceBasis,
            },
            explanation: "Fake example: local solar supplies the selected slot. Selection is not execution.",
        };
    },
} satisfies Router;

/** Preview wrapper choosing the Fake routing implementation. */
export function routeFakeJob(job: Job) {
    return route(job, fakeRouter);
}
