import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import type { SavedFleetMoment } from '../../../src/data/fleetMoments';
import type { ModeledJobOrigin } from '../../../src/data/dataCenters';
import type { ReplayProgress } from '../../../src/core/execution/replay/createPairedReplaySession';
import caiso from '../../fixtures/weather/caiso.json' with { type: 'json' };
import weather from '../../fixtures/weather/open-meteo.json' with { type: 'json' };
import { ComputeFlow } from '../compute-flow';

export type FleetEvidence = Pick<ReplayProgress, 'scenario' | 'selected' | 'baseline' | 'hour' | 'phase'> & { jobOrigins: ModeledJobOrigin[] };
export type LocationActivity = {
  locationId: string | null;
  hour: number;
  solarKW: number;
  computeKWh: number | null;
  storedKWh: number;
};

/** Drives the normal application; reads displayed values and engine evidence without calculating model results. */
export class FleetFlow {
  private readonly app: ComputeFlow;
  private readonly panel: Locator;
  private readonly activity: Locator;

  constructor(private readonly page: Page) {
    this.app = new ComputeFlow(page);
    this.panel = page.getByRole('region', { name: 'Live input fleet', exact: true });
    this.activity = this.panel.getByRole('region', { name: 'Location activity', exact: true });
  }

  async open(options: { weatherUnavailable?: boolean } = {}): Promise<void> {
    // Original captures retain their retrieval times. Only browser time advances into their shared valid window.
    // The owned server parses/archives the real weather response; this route supplies a newer real market capture
    // without changing the older market fixture used by the existing actual-CPU acceptance examples.
    const captureTime = Math.max(Date.parse(caiso.snapshot.retrievedAt), Date.parse(weather.retrievedAt));
    await this.page.clock.install({ time: new Date(captureTime) });
    await this.page.clock.pauseAt(new Date(captureTime + 1_000));
    await this.page.route('**/api/grid/caiso', route => route.fulfill({ json: {
      status: 'ready', revision: caiso.revision, snapshot: caiso.snapshot,
      lastAttemptAt: null, nextRefreshAt: null,
    } }));
    if (options.weatherUnavailable) {
      await this.page.route('**/api/weather/sites', route => route.fulfill({ json: {
        status: 'unavailable', revision: null, snapshot: null,
        lastAttemptAt: new Date(captureTime).toISOString(), nextRefreshAt: null,
        error: 'Open-Meteo is unavailable in this failure example.',
      } }));
    }
    await this.app.open();
    await expect(this.panel).toBeVisible();
    if (!options.weatherUnavailable) await expect(this.panel.getByRole('button', { name: 'Download model evidence', exact: true })).toBeEnabled();
  }

  async expectModeledExecution(): Promise<void> {
    await expect(this.panel.getByText('Modeled execution', { exact: true })).toBeVisible();
  }

  async modelHour(): Promise<number> {
    const value = await this.panel.getByLabel('Fleet model hour', { exact: true }).getAttribute('data-hour');
    if (value === null || !/^\d+$/.test(value)) throw new Error('The application did not expose its current model hour.');
    return Number(value);
  }

  private async openControls(): Promise<void> {
    const step = this.panel.getByRole('button', { name: 'Step', exact: true });
    if (!await step.isVisible()) await this.panel.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
    await expect(step).toBeVisible();
  }

  async pause(): Promise<void> {
    await this.openControls();
    const pause = this.panel.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.isEnabled()) await pause.click();
    await expect(this.panel.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
  }

  async letPlaybackAdvance(milliseconds: number): Promise<void> {
    await this.page.clock.runFor(milliseconds);
  }

  async step(): Promise<void> {
    await this.openControls();
    const before = await this.modelHour();
    await this.panel.getByRole('button', { name: 'Step', exact: true }).click();
    await this.page.clock.runFor(2_000);
    await expect(this.panel.getByLabel('Fleet model hour', { exact: true })).toHaveAttribute('data-hour', String(before + 1));
  }

  async showGeography(name: 'Show US' | 'Explore Utah'): Promise<void> {
    await this.panel.getByRole('button', { name, exact: true }).click();
    await this.page.clock.runFor(500);
  }

  async expectTransferOnMap(transferId: string, jobId: string): Promise<void> {
    const route = this.panel.locator('path[data-transfer-id=' + JSON.stringify(transferId) + ']');
    await expect(route).toBeVisible();
    await expect(route).toHaveAttribute('data-job-id', jobId);
    await expect(route).toHaveAttribute('aria-label', new RegExp('^Inspect transfer ' + jobId + ' from '));
  }
  async inspectTransferOnMap(transferId: string, jobId: string): Promise<void> {
    await this.expectTransferOnMap(transferId, jobId);
    await this.panel.locator('path[data-transfer-id=' + JSON.stringify(transferId) + ']').press('Enter');
    const job = this.panel.getByRole('region', { name: 'Job activity', exact: true });
    await expect(job).toBeVisible();
    await expect(job).toHaveAttribute('data-job-id', jobId);
  }
  async inspectLocation(name: string): Promise<void> {
    await this.panel.getByRole('button', { name: 'Inspect ' + name, exact: true }).click();
    await expect(this.activity).toBeVisible();
  }

  async expectUsefulHover(name: string): Promise<void> {
    await this.panel.getByRole('button', { name: 'Inspect ' + name, exact: true }).hover();
    const tooltip = this.panel.locator('.leaflet-tooltip');
    await expect(tooltip).toContainText(name);
    await expect(tooltip).toContainText(/modeled GPUs/i);
    await expect(tooltip).toContainText(/kW.*solar|solar.*kW/i);
  }

  async currentLocation(): Promise<LocationActivity> {
    await expect(this.activity).toBeVisible();
    const number = async (testId: string) => {
      const text = (await this.activity.getByTestId(testId).innerText()).replaceAll(',', '');
      const value = Number.parseFloat(text);
      if (!Number.isFinite(value)) throw new Error('No numeric rendered value for ' + testId + ': ' + text);
      return value;
    };
    const hour = await this.activity.getAttribute('data-hour');
    if (hour === null || !/^\d+$/.test(hour)) throw new Error('Location activity omitted its current model hour.');
    return {
      locationId: await this.activity.getAttribute('data-location-id'), hour: Number(hour),
      solarKW: await number('location-solar-kw'),
      computeKWh: (await this.activity.getByTestId('location-compute-kwh').innerText()).trim() === 'Pending' ? null : await number('location-compute-kwh'),
      storedKWh: await number('location-storage-kwh'),
    };
  }

  async evidence(): Promise<FleetEvidence> {
    const button = this.panel.getByRole('button', { name: 'Download model evidence', exact: true });
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([this.page.waitForEvent('download'), button.click()]);
    const path = await download.path();
    if (!path) throw new Error('The application did not download its current model evidence.');
    return JSON.parse(await readFile(path, 'utf8')) as FleetEvidence;
  }

  async expectJobState(id: string, state: string): Promise<void> {
    const job = this.panel.getByRole('button', { name: 'Inspect ' + id, exact: true });
    await expect(job).toHaveAttribute('data-job-state', state);
    await job.click();
    await expect(this.panel.getByRole('region', { name: 'Job activity', exact: true })).toContainText(id);
  }

  async inspectDataCenter(name: string): Promise<void> {
    await this.panel.getByRole('button', { name: 'Inspect data center ' + name, exact: true }).click();
    await expect(this.panel.getByRole('region', { name: 'Data center activity', exact: true })).toBeVisible();
  }

  async expectDataCenterSource(id: string, sourceUrl: string, submissions: number): Promise<void> {
    const origin = this.panel.getByRole('region', { name: 'Data center activity', exact: true });
    await expect(origin).toBeVisible();
    await expect(origin).toHaveAttribute('data-origin-id', id);
    await expect(origin).toContainText('SIMULATED JOB SOURCE');
    await expect(origin).toContainText(`${submissions} simulated submissions`);
    await expect(origin).toContainText('No facility workload or telemetry connection.');
    await expect(origin.getByRole('link', { name: 'Operator location source', exact: true })).toHaveAttribute('href', sourceUrl);
  }

  async expectAdmissionOnMap(jobId: string): Promise<void> {
    const route = this.panel.locator('path[data-event-id=' + JSON.stringify('admission:' + jobId) + ']');
    await expect(route).toBeVisible();
    await expect(route).toHaveAttribute('data-job-id', jobId);
  }
  async dropSolarAt(locationId: string): Promise<void> {
    await this.openControls();
    await this.panel.getByRole('combobox', { name: 'Disruption location', exact: true }).selectOption(locationId);
    const drop = this.panel.getByRole('button', { name: 'Drop solar', exact: true });
    await expect(drop).toBeEnabled();
    await drop.click();
  }

  async saveFrozenMoment(): Promise<SavedFleetMoment> {
    await this.openControls();
    const [response] = await Promise.all([
      this.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/fleet/captures'),
      this.panel.getByRole('button', { name: 'Save frozen moment', exact: true }).click(),
    ]);
    expect(response.status()).toBe(201);
    const saved = await response.json() as SavedFleetMoment;
    expect(saved.revision).toMatch(/^[a-f0-9]{64}$/);
    await expect(this.panel.getByTestId('frozen-capture-id')).toHaveText(saved.revision);
    return saved;
  }

  async retrieveFrozenMoment(revision: string, expectedHour: number): Promise<SavedFleetMoment> {
    const input = this.panel.getByRole('textbox', { name: 'Frozen capture ID', exact: true });
    if (!await input.isVisible()) await this.panel.getByText('Retrieve a frozen moment', { exact: true }).click();
    await input.fill(revision);
    return this.readFrozenMoment(revision, expectedHour, () => this.panel.getByRole('button', { name: 'Retrieve frozen moment', exact: true }).click());
  }

  async restoreFrozenMoment(revision: string, expectedHour: number): Promise<SavedFleetMoment> {
    await this.openControls();
    const restore = this.panel.getByRole('button', { name: 'Restore frozen moment', exact: true });
    await expect(restore).toBeVisible();
    return this.readFrozenMoment(revision, expectedHour, () => restore.click());
  }

  async reloadFrozenMomentWithoutCurrentFeeds(revision: string, expectedHour: number): Promise<SavedFleetMoment> {
    for (const endpoint of ['weather/sites', 'grid/eia', 'grid/caiso']) {
      await this.page.route('**/api/' + endpoint, route => route.fulfill({ json: {
        status: 'unavailable', revision: null, snapshot: null,
        lastAttemptAt: null, nextRefreshAt: null, error: 'Current feed is unavailable in this recovery example.',
      } }));
    }
    return this.readFrozenMoment(revision, expectedHour, () => this.page.goto('/?capture=' + revision).then(() => {}));
  }

  private async readFrozenMoment(revision: string, expectedHour: number, retrieve: () => Promise<void>): Promise<SavedFleetMoment> {
    const [response] = await Promise.all([
      this.page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname === '/api/fleet/captures' && url.searchParams.get('revision') === revision;
      }),
      retrieve(),
    ]);
    expect(response.status()).toBe(200);
    const saved = await response.json() as SavedFleetMoment;
    expect(saved.revision).toBe(revision);
    // Restoring yields between deterministic replay ticks; let the browser complete those scheduled turns.
    await expect.poll(async () => {
      await this.page.clock.runFor(250);
      return this.modelHour();
    }).toBe(expectedHour);
    await expect(this.page).toHaveURL(new RegExp('[?&]capture=' + revision + '(?:&|$)'));
    return saved;
  }

  async expectPausedAt(hour: number): Promise<void> {
    await this.openControls();
    await expect(this.panel.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await expect(this.panel.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    await this.page.clock.runFor(7_000);
    expect(await this.modelHour()).toBe(hour);
  }
  async expectWeatherUnavailable(): Promise<void> {
    await expect(this.panel).toContainText(/Waiting for site-specific Open-Meteo forecasts/i);
    await this.page.clock.runFor(8_000);
    await expect(this.panel.locator('button[data-job-state]')).toHaveCount(0);
    const download = this.panel.getByRole('button', { name: 'Download model evidence', exact: true });
    if (await download.count()) await expect(download).toBeDisabled();
  }
}
