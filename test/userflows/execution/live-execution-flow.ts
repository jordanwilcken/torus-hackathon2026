import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { LocalRun } from '../../../src/data/LocalRun.type';
import { ComputeFlow } from '../compute-flow';

type RunSubmission = {
  policy?: 'Normal' | 'Hold';
};

type IntegerSumSubmission = RunSubmission & { values: number[] };

/** Drives the application UI and reads its evidence; it never executes or invents work. */
export class LiveExecutionFlow {
  private readonly app: ComputeFlow;
  private readonly panel: Locator;
  private posts = 0;
  private observedRequestId?: string;

  constructor(private readonly page: Page) {
    this.app = new ComputeFlow(page);
    this.panel = page.getByRole('region', { name: 'Local execution', exact: true });
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/jobs/runs') this.posts++;
    });
  }

  get submittedRunCount(): number { return this.posts; }
  get lastSubmittedRequestId(): string {
    if (!this.observedRequestId) throw new Error('No request has been submitted through the UI.');
    return this.observedRequestId;
  }

  get runIdInAddress(): string | null { return new URL(this.page.url()).searchParams.get('run'); }

  async open(): Promise<void> {
    // ComputeFlow only replaces background map tiles, never public inputs or job endpoints.
    await this.app.open();
    await this.ready();
  }

  private async ready(): Promise<void> {
    const openWork = this.page.getByRole('link', { name: 'Run CPU work', exact: true });
    await expect.poll(async () => await this.panel.isVisible() || await openWork.isVisible()).toBe(true);
    if (!await this.panel.isVisible()) await openWork.click();
    await expect(this.panel).toBeVisible();
    await expect(this.panel.getByText('Recorded public inputs', { exact: false })).toBeVisible();
    await expect(this.panel.getByRole('button', { name: 'Run locally', exact: true })).toBeEnabled();
    if (await this.page.getByRole('dialog', { name: 'Run CPU work', exact: true }).isVisible()) {
      await expect(this.panel.getByLabel('Request ID', { exact: true })).toHaveCount(0);
      await expect(this.panel.locator('input[type=number]')).toHaveCount(0);
    }
  }

  async submitIntegerSum(job: IntegerSumSubmission): Promise<LocalRun> {
    await this.panel.getByRole('combobox', { name: 'Workload', exact: true }).selectOption('integer-sum');
    await this.panel.getByLabel('Integer values', { exact: true }).fill(job.values.join(','));
    return this.submit(job);
  }

  async submitGridSummary(job: RunSubmission = {}): Promise<LocalRun> {
    await this.panel.getByRole('combobox', { name: 'Workload', exact: true }).selectOption('grid-summary');
    return this.submit(job);
  }

  private async submit(job: RunSubmission): Promise<LocalRun> {
    const policy = job.policy ?? 'Normal';
    const choice = this.panel.getByRole('button', { name: policy, exact: true });
    if (await choice.count()) {
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
    } else {
      // Standalone legacy fixtures retain their explicit settings UI.
      await this.panel.getByLabel('Maximum PACE demand (MW)', { exact: true }).fill(policy === 'Hold' ? '0' : '20000');
      await this.panel.getByLabel('Maximum wholesale price (USD/MWh)', { exact: true }).fill('100');
    }
    const [request] = await Promise.all([
      this.page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/jobs/runs'),
      this.panel.getByRole('button', { name: 'Run locally', exact: true }).click(),
    ]);
    const submitted = request.postDataJSON() as { requestId: string };
    expect(submitted.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    this.observedRequestId = submitted.requestId;
    return this.completedRun(submitted.requestId);
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
    await this.reveal(this.panel.getByTestId('actual-output'));
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

  private async reveal(content: Locator): Promise<void> {
    if (!await content.isVisible()) await content.locator('xpath=ancestor::details[1]').locator('summary').click();
  }

  async expectEvidenceLabels(run: LocalRun): Promise<void> {
    for (const input of run.decision.inputs) {
      const revision = this.panel.getByText('Input revision ' + input.revision, { exact: true });
      await this.reveal(revision);
      await expect(revision).toBeVisible();
    }
    await expect(this.panel.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
    await expect(this.panel.getByText(run.decision.explanation, { exact: true })).toBeVisible();
    await expect(this.panel).toContainText('This computer');
    await expect(this.panel).toContainText('Measured energy: unavailable');
    const comparison = this.panel.getByRole('heading', { name: 'Modeled storage comparison', exact: true, includeHidden: true });
    await this.reveal(comparison);
    await expect(comparison).toBeVisible();
  }
}
