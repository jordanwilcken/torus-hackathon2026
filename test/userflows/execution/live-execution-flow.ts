import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { LocalRun } from '../../../src/data/LocalRun.type';
import { ComputeFlow } from '../compute-flow';

type RunSubmission = {
  requestId: string;
  maximumDemandMW?: number;
  maximumWholesaleUsdPerMWh?: number;
};

type IntegerSumSubmission = RunSubmission & { values: number[] };

/** Drives the application UI and reads its evidence; it never executes or invents work. */
export class LiveExecutionFlow {
  private readonly app: ComputeFlow;
  private readonly panel: Locator;
  private posts = 0;

  constructor(private readonly page: Page) {
    this.app = new ComputeFlow(page);
    this.panel = page.getByRole('region', { name: 'Server execution', exact: true });
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/jobs/runs') this.posts++;
    });
  }

  get submittedRunCount(): number { return this.posts; }

  get runIdInAddress(): string | null { return new URL(this.page.url()).searchParams.get('run'); }

  async open(): Promise<void> {
    // ComputeFlow only replaces background map tiles, never public inputs or job endpoints.
    await this.app.open();
    await this.ready();
  }

  private async ready(): Promise<void> {
    await expect(this.panel).toBeVisible();
    await expect(this.panel.getByText('Recorded public inputs', { exact: false })).toBeVisible();
    await expect(this.panel.getByRole('button', { name: 'Run on server', exact: true })).toBeEnabled();
  }

  async submitIntegerSum(job: IntegerSumSubmission): Promise<LocalRun> {
    await this.panel.getByRole('combobox', { name: 'Workload', exact: true }).selectOption('integer-sum');
    await this.panel.getByLabel('Integer values', { exact: true }).fill(job.values.join(','));
    return this.submit(job);
  }

  async submitGridSummary(job: RunSubmission): Promise<LocalRun> {
    await this.panel.getByRole('combobox', { name: 'Workload', exact: true }).selectOption('grid-summary');
    return this.submit(job);
  }

  private async submit(job: RunSubmission): Promise<LocalRun> {
    await this.panel.getByLabel('Request ID', { exact: true }).fill(job.requestId);
    await this.panel.getByLabel('Maximum PACE demand (MW)', { exact: true }).fill(String(job.maximumDemandMW ?? 20_000));
    await this.panel.getByLabel('Maximum wholesale price (USD/MWh)', { exact: true })
      .fill(String(job.maximumWholesaleUsdPerMWh ?? 1_000));
    await this.panel.getByRole('button', { name: 'Run on server', exact: true }).click();
    return this.completedRun(job.requestId);
  }

  private async completedRun(requestId: string): Promise<LocalRun> {
    const evidence = this.panel.getByTestId('run-evidence');
    await expect(evidence).toContainText(requestId);
    await expect(this.panel.getByTestId('run-status')).toHaveText(/^(done|failed|blocked)$/);
    if (!await evidence.isVisible()) {
      await evidence.locator('xpath=ancestor::details[1]').locator('summary').click();
    }
    await expect(evidence).toBeVisible();
    const run: LocalRun = JSON.parse(await evidence.innerText());
    expect(run.request.requestId).toBe(requestId);
    return run;
  }

  async downloadOutput(): Promise<string> {
    const link = this.panel.getByRole('link', { name: 'Download actual output', exact: true });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    if (!href) throw new Error('The application did not expose the actual output artifact.');
    const response = await this.page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/json\b/);
    const text = await response.text();
    await expect(this.panel.getByTestId('actual-output')).toHaveText(text);
    return text;
  }

  async hasOutputArtifact(): Promise<boolean> {
    return await this.panel.getByRole('link', { name: 'Download actual output', exact: true }).count() > 0;
  }

  async reloadRun(requestId: string): Promise<LocalRun> {
    await this.page.reload();
    await this.ready();
    return this.completedRun(requestId);
  }

  async expectEvidenceLabels(run: LocalRun): Promise<void> {
    for (const input of run.decision.inputs) {
      await expect(this.panel.getByText('Input revision ' + input.revision, { exact: true })).toBeVisible();
    }
    await expect(this.panel.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
    await expect(this.panel.getByText(run.decision.explanation, { exact: true })).toBeVisible();
    await expect(this.panel.getByRole('heading', { name: 'Run real work on the application server', exact: true })).toBeVisible();
    await expect(this.panel.getByText(new RegExp('^' + run.execution.location + ' · CPU ·'))).toBeVisible();
    await expect(this.panel).toContainText('Measured energy: unavailable');
    await expect(this.panel.getByRole('heading', { name: 'Modeled Torus storage comparison', exact: true })).toBeVisible();
  }
}
