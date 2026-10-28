import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import type { LocalRun } from '../../../src/data/LocalRun.type';
import type { PairedReplay } from '../../../src/core/execution/replay/Replay.types';
import { LiveExecutionFlow } from '../execution/live-execution-flow';
import { expectWorkspaceNavigation, openWorkspaceTool } from '../workspace-navigation';

/** Normal-page navigation and downloaded evidence; no routing, execution or energy calculations. */
export class DemoFlow {
  private readonly cpu: LiveExecutionFlow;
  private readonly publicInputs: Locator;
  private readonly cpuPanel: Locator;
  private readonly replay: Locator;
  private readonly controls: Locator;

  constructor(private readonly page: Page) {
    this.cpu = new LiveExecutionFlow(page);
    this.publicInputs = page.getByRole('region', { name: 'Source details', exact: true });
    this.cpuPanel = page.getByRole('region', { name: 'Local execution', exact: true });
    this.replay = page.getByRole('region', { name: 'Paired replay', exact: true });
    this.controls = page.getByRole('region', { name: 'Simulation controls', exact: true });
  }

  get submittedRunCount(): number { return this.cpu.submittedRunCount; }
  get lastSubmittedRequestId(): string { return this.cpu.lastSubmittedRequestId; }
  get runIdInAddress(): string | null { return this.cpu.runIdInAddress; }

  async open(): Promise<void> {
    // Existing driver replaces only background map tiles. Owned server supplies the original public captures.
    await this.cpu.open();
    expect(new URL(this.page.url()).pathname).toBe('/');
    expect(new URL(this.page.url()).search).toBe('');
    await this.closeTool();
    await expect(this.page.getByRole('region', { name: 'Live input fleet', exact: true })).toBeVisible();
    await expect(this.replay).toHaveCount(0);
    await expect(this.page.getByRole('button', { name: /Route (?:next )?Fake job/i })).toHaveCount(0);
    await this.expectNavigationAvailable();
  }

  private async expectNavigationAvailable(): Promise<void> {
    await expectWorkspaceNavigation(this.page);
  }

  private async closeTool(): Promise<void> {
    const close = this.page.getByRole('button', { name: 'Close tool', exact: true });
    if (await close.isVisible()) await close.click();
  }

  async visit(section: 'Public inputs' | 'Run CPU work' | 'Compare scheduling'): Promise<void> {
    await this.closeTool();
    await this.expectNavigationAvailable();
    if (section === 'Public inputs') {
      await this.page.getByRole('link', { name: 'Live fleet', exact: true }).click();
      await this.page.getByRole('button', { name: 'EIA source', exact: true }).click();
      await expect(this.publicInputs).toBeInViewport();
    } else {
      await openWorkspaceTool(this.page, section);
      await expect(section === 'Run CPU work' ? this.cpuPanel : this.replay).toBeInViewport();
    }
    await this.expectNavigationAvailable();
  }

  async expectPublicInputs(demand: string, sources: { eia: string; caiso: string }): Promise<void> {
    await expect(this.publicInputs).toContainText(demand);
    await expect(this.publicInputs.getByRole('link', { name: 'EIA source', exact: true })).toHaveAttribute('href', sources.eia);
    await this.publicInputs.getByRole('button', { name: 'Close source details', exact: true }).click();
    await this.page.getByRole('button', { name: 'CAISO source', exact: true }).click();
    await expect(this.publicInputs.getByRole('link', { name: 'CAISO source', exact: true })).toHaveAttribute('href', sources.caiso);
    await this.publicInputs.getByRole('button', { name: 'Close source details', exact: true }).click();
  }

  async analyzePublicDemand(): Promise<LocalRun> {
    await expect(this.cpuPanel.getByRole('combobox', { name: 'Workload', exact: true })).toHaveValue('grid-summary');
    await expect(this.cpuPanel.getByRole('button', { name: 'Normal', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const run = await this.cpu.submitGridSummary();
    expect(run.request.policy.maximumWholesaleUsdPerMWh).toBe(100);
    return run;
  }
  async expectExecutionLabels(): Promise<void> {
    await expect(this.cpuPanel).toContainText('Recorded public inputs');
    const inputDetails = this.cpuPanel.getByText('Historical input replay; the worker executes now.', { exact: false });
    await this.reveal(inputDetails);
    await expect(inputDetails).toBeVisible();
    await expect(this.cpuPanel).toContainText('Historical input replay; the worker executes now.');
    await expect(this.cpuPanel).toContainText('Measured energy: unavailable');
    await expect(this.cpuPanel).toContainText('Measured carbon: unavailable');
    const comparison = this.cpuPanel.getByRole('heading', { name: 'Modeled storage comparison', exact: true, includeHidden: true });
    await this.reveal(comparison);
    await expect(comparison).toBeVisible();
  }

  private async reveal(content: Locator): Promise<void> {
    if (!await content.isVisible()) await content.locator('xpath=ancestor::details[1]').locator('summary').click();
  }

  private async download(action: Locator): Promise<string> {
    const [download] = await Promise.all([this.page.waitForEvent('download'), action.click()]);
    const path = await download.path();
    if (!path) throw new Error('The application did not provide its downloaded evidence file.');
    return readFile(path, 'utf8');
  }

  async downloadCpuOutput(): Promise<string> {
    const text = await this.download(this.cpuPanel.getByRole('link', { name: 'Download actual output', exact: true }));
    await this.reveal(this.cpuPanel.getByTestId('actual-output'));
    await expect(this.cpuPanel.getByTestId('actual-output')).toHaveText(text);
    return text;
  }

  async expectModeledReplay(): Promise<void> {
    await expect(this.replay).toContainText('declared synthetic energy and jobs');
    await expect(this.replay).toContainText('All work and energy values are modeled.');
    await expect(this.replay.getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeDisabled();
    await this.replay.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
    await expect(this.controls).toBeVisible();
  }

  async stepReplayTo(hour: number, totalHours = 4): Promise<void> {
    await this.controls.getByRole('button', { name: 'Step', exact: true }).click();
    await expect(this.replay.getByLabel('Replay hour', { exact: true })).toHaveText(`${hour} / ${totalHours}`);
    await expect(this.controls.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
  }

  async expectJobState(id: string, state: string): Promise<void> {
    await expect(this.replay.getByRole('button', { name: 'Inspect job ' + id, exact: true })).toHaveAttribute('data-job-state', state);
  }

  async inspectPublishedHour(site: string, hour: string, asOf: string): Promise<void> {
    const prices = this.replay.getByRole('region', { name: 'Published model prices', exact: true });
    await expect(prices).toBeVisible();
    await expect(prices).toContainText(/published.*as of/i);
    const publishedAt = await prices.locator('header > p > time').getAttribute('datetime');
    expect(Date.parse(publishedAt!)).toBe(Date.parse(asOf));
    const hourButton = prices.getByRole('button', { name: new RegExp('^Inspect ' + site + '.*' + hour + ' UTC,') });
    await hourButton.click();
    await expect(hourButton).toHaveAttribute('aria-pressed', 'true');
    const details = prices.getByRole('region', { name: 'Price details', exact: true });
    await expect(details).toContainText(hour);
    await expect(details).toContainText('Projected capacity');
    await expect(details).toContainText('not a reservation');
  }

  async finishReplay(totalHours = 4, completedJobs = 3): Promise<void> {
    await this.controls.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('4');
    await this.controls.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(this.replay.getByLabel('Replay hour', { exact: true })).toHaveText(`${totalHours} / ${totalHours}`);
    await expect(this.replay.locator('[data-job-state="Done"]')).toHaveCount(completedJobs);
    await expect(this.replay.getByRole('region', { name: 'Fleet comparison', exact: true })).toHaveAttribute('data-comparison', 'comparable');
    await expect(this.replay).toContainText('Comparable modeled runs');
    await expect(this.replay.getByRole('region', { name: 'Job choice', exact: true })).toContainText('Modeled execution complete');
    await expect(this.replay.getByRole('region', { name: 'Modeled usage evidence', exact: true })).toBeVisible();
    await expect(this.replay.getByRole('region', { name: 'Actual usage evidence', exact: true })).toHaveCount(0);
    await expect(this.replay.getByRole('button', { name: 'Download evidence JSON', exact: true })).toBeEnabled();
  }

  async chooseModeledScenario(label: 'Wait for solar' | 'Forecast miss'): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Modeled scenario', exact: true }).selectOption({ label });
    await expect(this.replay.getByLabel('Replay hour', { exact: true })).toHaveText('0 / 3');
  }

  async displayedReductions(): Promise<{ carbonKg: number; modeledCostUsd: number }> {
    const carbon = this.replay.getByTestId('modeled-carbon-reduction');
    const cost = this.replay.getByTestId('modeled-cost-reduction');
    await expect(carbon).toBeVisible();
    await expect(cost).toBeVisible();
    return { carbonKg: Number(await carbon.innerText()), modeledCostUsd: Number((await cost.innerText()).replace(/^\$/, '')) };
  }

  async downloadReplayEvidence(): Promise<PairedReplay> {
    return JSON.parse(await this.download(this.replay.getByRole('button', { name: 'Download evidence JSON', exact: true }))) as PairedReplay;
  }

  async currentReceipt(): Promise<LocalRun> {
    const evidence = this.cpuPanel.getByTestId('run-evidence');
    if (!await evidence.isVisible()) await evidence.locator('xpath=ancestor::details[1]').locator('summary').click();
    await expect(evidence).toBeVisible();
    return JSON.parse(await evidence.innerText()) as LocalRun;
  }

  async reloadSavedRun(requestId: string): Promise<LocalRun> {
    const result = await this.cpu.reloadRun(requestId);
    await this.expectNavigationAvailable();
    return result;
  }
}
