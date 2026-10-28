import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import captured from '../../../examples/replay/job-stream.json' with { type: 'json' };
import solarShift from '../../../examples/replay/solar-shift.json' with { type: 'json' };
import type { PairedReplay, ReplayScenario } from '../../../src/core/execution/replay/Replay.types';

const replay = (page: Page) => page.getByRole('region', { name: 'Paired replay', exact: true });
const controls = (page: Page) => page.getByRole('region', { name: 'Simulation controls', exact: true });
const job = (page: Page, id: string) => replay(page).getByRole('button', { name: `Inspect job ${id}`, exact: true });

async function openReplay(page: Page, supplied?: ReplayScenario): Promise<void> {
    // Only unrelated map image requests are replaced. The page executes its real production replay runtime.
    await page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
    }));
    if (supplied) {
        // Fault injection supplies raw captured inputs; no routing, dispatch or comparison result is stubbed.
        await page.route('**/examples/replay/job-stream.json*', route => route.fulfill({
            contentType: 'text/javascript', body: 'export default ' + JSON.stringify(supplied) + ';',
        }));
    }
    await page.goto('/?scenario=paired-replay');
    await expect(replay(page)).toBeVisible();
    await replay(page).getByRole('button', { name: 'Chaos monkey', exact: true }).click();
    await expect(controls(page)).toBeVisible();
}

async function settleNextHour(page: Page, hour: number, totalHours = 4): Promise<void> {
    await controls(page).getByRole('button', { name: 'Step', exact: true }).click();
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText(`${hour} / ${totalHours}`);
    await expect(controls(page).getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
}

async function finishReplay(page: Page): Promise<void> {
    await controls(page).getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('4');
    await controls(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('4 / 4');
    await expect(replay(page).getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeEnabled();
}

async function exportedEvidence(page: Page): Promise<PairedReplay> {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        replay(page).getByRole('button', { name: 'Download evidence JSON', exact: true }).click(),
    ]);
    const file = await download.path();
    if (!file) throw new Error('The actual replay evidence download is missing.');
    return JSON.parse(await readFile(file, 'utf8')) as PairedReplay;
}

test('successive jobs arrive, wait, execute and remain inspectable on the production map', async ({ page }) => {
    await openReplay(page);
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('0 / 4');
    await expect(job(page, 'job-01')).toHaveAttribute('data-job-state', 'Upcoming');
    await expect(job(page, 'job-02')).toHaveAttribute('data-job-state', 'Upcoming');
    await expect(job(page, 'job-03')).toHaveAttribute('data-job-state', 'Upcoming');
    await expect(replay(page).getByRole('table', { name: 'Modeled fleet totals', exact: true })).toHaveCount(0);
    await expect(replay(page).getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeDisabled();

    await settleNextHour(page, 1);
    await expect(job(page, 'job-01')).toHaveAttribute('data-job-state', 'Waiting');
    await expect(job(page, 'job-02')).toHaveAttribute('data-job-state', 'Upcoming');
    await expect(replay(page).getByRole('table', { name: 'Job decision history', exact: true })).toContainText('Waiting');
    await expect(replay(page).getByRole('img', { name: 'Job placement: job-01 has no selected site', exact: true })).toBeVisible();
    await expect(replay(page).getByRole('img', { name: /Job placement: job-01.*execution observations supplied/ })).toHaveCount(0);

    await controls(page).getByRole('button', { name: 'Step', exact: true }).click();
    await expect(job(page, 'job-01')).toHaveAttribute('data-job-state', 'Running');
    await expect(replay(page).getByRole('region', { name: 'Job details', exact: true })).toHaveAttribute('data-active-job-id', 'job-01');
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('2 / 4');
    await expect(job(page, 'job-01')).toHaveAttribute('data-job-state', 'Done');
    await expect(job(page, 'job-02')).toHaveAttribute('data-job-state', 'Waiting');

    await controls(page).getByRole('button', { name: 'Step', exact: true }).click();
    await expect(job(page, 'job-03')).toHaveAttribute('data-job-state', 'Running');
    await expect(replay(page).getByRole('region', { name: 'Job details', exact: true })).toHaveAttribute('data-active-job-id', 'job-03');
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('3 / 4');
    await expect(replay(page).getByRole('region', { name: 'Energy timeline', exact: true })).toContainText('Site B');
    await expect(replay(page).getByRole('region', { name: 'Modeled usage evidence', exact: true })).toContainText('job-03');
    await settleNextHour(page, 4);
    await expect(replay(page).locator('[data-job-state="Done"]')).toHaveCount(3);
    await expect(replay(page).getByRole('table', { name: 'Modeled fleet totals', exact: true })).toHaveCount(1);

    await job(page, 'job-01').click();
    await expect(replay(page).getByRole('region', { name: 'Job details', exact: true })).toHaveAttribute('data-active-job-id', 'job-01');
    await expect(replay(page).locator('.replay-geography')).toContainText('Inspecting retained hour 1 for job-01.');
    await expect(replay(page).getByRole('region', { name: 'Energy timeline', exact: true })).toContainText('Site A');
    await expect(replay(page).getByRole('table', { name: 'Job decision history', exact: true })).toContainText('Waiting');
    await expect(replay(page).getByRole('table', { name: 'Modeled work receipts', exact: true }).locator('td[data-value="1"]')).toHaveCount(1);
    const evidence = await exportedEvidence(page);
    expect(evidence.comparison.comparison).toBe('comparable');
    expect(evidence.selected.finalJobs.map(item => item.state)).toEqual(['done', 'done', 'done']);
    expect(evidence.selected.run.ticks.flatMap(tick => tick.executions).reduce((sum, receipt) => sum + receipt.completedGpuH, 0)).toBe(3);
    expect(evidence.baseline.run.ticks.flatMap(tick => tick.meters)).toHaveLength(8);
    expect(evidence.selected.run.ticks.flatMap(tick => tick.meters)).toHaveLength(8);
});

test('a clicked solar-drop event changes raw execution and reset reproduces the original run', async ({ page }) => {
    await openReplay(page);
    await finishReplay(page);
    const original = await exportedEvidence(page);
    await controls(page).getByRole('button', { name: 'Reset', exact: true }).click();
    await settleNextHour(page, 1);
    await controls(page).getByRole('button', { name: 'Apply event', exact: true }).click();
    await expect(controls(page)).toContainText('Scheduled solar drop at Site A for hour 1');
    await finishReplay(page);
    const changed = await exportedEvidence(page);
    expect(changed.scenario.events).toEqual([{ atHour: 1, kind: 'solar-drop', payload: { locationId: 'A' } }]);
    expect(changed.scenario.sites[0].forecast).toEqual(original.scenario.sites[0].forecast);
    const originalMeter = original.selected.run.ticks[1].meters.find(meter => meter.locationId === 'A')!;
    const changedMeter = changed.selected.run.ticks[1].meters.find(meter => meter.locationId === 'A')!;
    expect(originalMeter.solarKWh).toBeGreaterThan(0);
    expect(changedMeter.solarKWh).toBe(0);
    expect(changedMeter.gridImportKWh).toBeGreaterThan(originalMeter.gridImportKWh!);

    await controls(page).getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('0 / 4');
    await expect(replay(page).locator('[data-job-state="Upcoming"]')).toHaveCount(3);
    await expect(replay(page).getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeDisabled();
    await finishReplay(page);
    expect(await exportedEvidence(page)).toEqual(original);
});

test('Pause stops further real clock steps and Reset clears the running job stream', async ({ page }) => {
    await openReplay(page);
    await controls(page).getByRole('button', { name: 'Play', exact: true }).click();
    await controls(page).getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(1900);
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('0 / 4');
    await controls(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('1 / 4');
    await controls(page).getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(controls(page).getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
    await page.waitForTimeout(1900);
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('1 / 4');
    await settleNextHour(page, 2);
    await controls(page).getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('0 / 4');
    await expect(replay(page).locator('[data-job-state="Upcoming"]')).toHaveCount(3);
    await expect(replay(page).getByRole('table', { name: 'Job decision history', exact: true }).getByRole('row')).toHaveCount(1);
});

test('an infeasible raw site input stops honestly and preserves partial noncomparable evidence', async ({ page }) => {
    const supplied = structuredClone(captured) as ReplayScenario;
    supplied.sites[1].observations[0].supply!.fixedLoadKW = 100;
    await openReplay(page, supplied);
    await settleNextHour(page, 1);
    await expect(replay(page)).toContainText('Replay stopped; partial evidence retained');
    await expect(controls(page)).toContainText('infeasible');
    await expect(replay(page).getByText('Both runs complete', { exact: true })).toHaveCount(0);
    await expect(replay(page).locator('[data-job-state="Running"]')).toHaveCount(0);
    await expect(replay(page).locator('[data-job-state="Stopped"]')).toHaveCount(3);
    await expect(replay(page).getByRole('region', { name: 'Fleet comparison', exact: true })).toHaveAttribute('data-comparison', 'not-comparable');
    const evidence = await exportedEvidence(page);
    expect(evidence.baseline.run.ticks.some(tick => !tick.feasible)).toBe(true);
    expect(evidence.selected.run.ticks.some(tick => !tick.feasible)).toBe(true);
    expect(evidence.selected.finalJobs.some(item => item.state !== 'done')).toBe(true);
    expect(evidence.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
});

test('a failed baseline retains partial evidence while the coordinated arm continues to real completion', async ({ page }) => {
    const supplied = structuredClone(solarShift) as ReplayScenario;
    const site = supplied.sites[0];
    site.configuration.storage = {
        initial: { storedKWh: 1, carbonKg: 0.4, electricityUsd: 0.05 },
        limits: { capacityKWh: 1, chargeKW: 0, dischargeKW: 1 },
        efficiency: { charge: 1, discharge: 1 },
    };
    for (const input of [...site.forecast, ...site.observations]) input.supply!.gridImportLimitKW = 0;
    site.observations[1].supply!.solarKW = 0;
    site.observations[1].supply!.fixedLoadKW = 1;
    await openReplay(page, supplied);
    await settleNextHour(page, 1, 3);
    await settleNextHour(page, 2, 3);
    await expect(controls(page)).toContainText('Home FIFO stopped');
    await expect(controls(page)).toContainText('Coordinated continues');
    await expect(job(page, 'training')).toHaveAttribute('data-job-state', 'Waiting');
    await expect(controls(page).getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
    await expect(replay(page).getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeDisabled();

    await controls(page).getByRole('button', { name: 'Step', exact: true }).click();
    await expect(job(page, 'training')).toHaveAttribute('data-job-state', 'Running');
    await expect(replay(page).getByLabel('Replay hour', { exact: true })).toHaveText('3 / 3');
    await expect(job(page, 'training')).toHaveAttribute('data-job-state', 'Done');
    await expect(replay(page).getByLabel('Arm progress', { exact: true })).toHaveText('Home FIFO 2 / 3 · Coordinated 3 / 3');
    await expect(replay(page).getByText('Both runs complete', { exact: true })).toHaveCount(0);
    const evidence = await exportedEvidence(page);
    expect(evidence.baseline.run.ticks.map(tick => tick.feasible)).toEqual([true, false]);
    expect(evidence.selected.run.ticks.map(tick => tick.feasible)).toEqual([true, true, true]);
    expect(evidence.selected.finalJobs[0]).toMatchObject({ state: 'done', remainingGpuH: 0 });
    expect(evidence.selected.run.ticks.flatMap(tick => tick.executions).reduce((sum, receipt) => sum + receipt.completedGpuH, 0)).toBe(1);
    expect(evidence.comparison.comparison).toBe('not-comparable');
    expect(evidence.reductions).toEqual({ carbonKg: null, modeledCostUsd: null });
});
