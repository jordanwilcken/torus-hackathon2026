import { expect, type Locator, type Page } from '@playwright/test';
import { FleetFlow } from './fleet-flow';

/** Adds observations of visible event feedback to the established real-app fleet driver. */
export class FleetActivityFlow extends FleetFlow {
  private readonly activityPanel: Locator;

  constructor(private readonly activityPage: Page) {
    super(activityPage);
    this.activityPanel = activityPage.getByRole('region', { name: 'Live input fleet', exact: true });
  }

  private async controls(): Promise<void> {
    const step = this.activityPanel.getByRole('button', { name: 'Step', exact: true });
    if (!await step.isVisible()) await this.activityPanel.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
    await expect(step).toBeEnabled();
  }

  async setPlaybackSpeed(speed: 1 | 4): Promise<void> {
    await this.controls();
    await this.activityPanel.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption(String(speed));
  }

  /** Unlike FleetFlow.step, do not consume 2000ms before examining the newly emitted feedback. */
  async startNextHour(): Promise<void> {
    await this.controls();
    await this.activityPanel.getByRole('button', { name: 'Step', exact: true }).click();
    await this.activityPanel.getByRole('button', { name: 'Close controls', exact: true }).click();
  }

  private pulses(jobId: string): Locator {
    return this.activityPanel.locator('.fleet-event-pulse[data-event-id=' + JSON.stringify('admission:' + jobId) + ']');
  }

  async expectSubmission(jobId: string, source: string, destination: string): Promise<void> {
    const departure = this.pulses(jobId).and(this.activityPanel.locator('[data-endpoint="source"]'));
    await expect(departure).toHaveCount(1);
    await expect(departure).toBeVisible();
    await expect(departure).toBeInViewport();
    await expect(departure).toHaveAttribute('data-job-id', jobId);
    await expect(departure).toHaveAttribute('data-kind', 'submission');
    await expect(departure).toHaveAttribute('role', 'img');
    await expect(departure).toHaveAttribute('aria-label', jobId + ' · Simulated submission to home queue · source: ' + source + ' · ' + source + ' → ' + destination);
    await expect(this.activityPanel.locator('.fleet-event-tag')).toHaveCount(0);
  }

  async expectArrival(jobId: string, destination: string): Promise<void> {
    const pulses = this.pulses(jobId);
    await expect(pulses).toHaveCount(1);
    await expect(pulses).toHaveAttribute('data-endpoint', 'destination');
    await expect(pulses).toHaveAttribute('aria-label', new RegExp('destination: ' + destination));
    await expect(pulses).toBeVisible();
    await expect(pulses).toBeInViewport();
  }

  async expectNoPersistentClutter(): Promise<void> {
    await expect(this.activityPanel.locator('.fleet-event-tag, .fleet-node svg, .fleet-datacenter svg, path.fleet-admission, path.fleet-route')).toHaveCount(0);
  }

  async expectFeedbackPassesPointersThrough(): Promise<void> {
    const decoration = this.activityPanel.locator('.fleet-event-pulse, path.map-comet');
    expect(await decoration.count()).toBeGreaterThanOrEqual(1);
    expect(await decoration.evaluateAll(elements => elements.every(element => getComputedStyle(element).pointerEvents === 'none'))).toBe(true);
  }

  async inspectPaintedSaltLake(): Promise<void> {
    const button = this.activityPanel.getByRole('button', { name: 'Inspect Salt Lake City', exact: true });
    const body = button.locator('.fleet-node-body');
    await expect(body).toBeVisible();
    const point = await body.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      return { x, y, target: document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') };
    });
    expect(point.target).toBe('Inspect Salt Lake City');
    // A real pointer click must reach the painted symbol with event feedback still present.
    await this.activityPage.mouse.click(point.x, point.y);
    const inspector = this.activityPanel.getByRole('region', { name: 'Location activity', exact: true });
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-location-id', 'A');
  }

  async expectEmptyMarkerMarginToStayMapSpace(): Promise<void> {
    const close = this.activityPanel.getByRole('button', { name: 'Close controls', exact: true });
    if (await close.isVisible()) await close.click();
    const button = this.activityPanel.getByRole('button', { name: 'Inspect Salt Lake City', exact: true });
    const bounds = await button.boundingBox();
    if (!bounds) throw new Error('Salt Lake marker is not on the map.');
    const point = { x: bounds.x + 1, y: bounds.y + 1 };
    await this.activityPage.mouse.click(point.x, point.y);
    await expect(this.activityPanel.getByRole('region', { name: 'Location activity', exact: true })).toHaveCount(0);
    const hit = await this.activityPage.evaluate(({ x, y }) => ({
      hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 600),
      intercepted: Boolean(document.elementFromPoint(x, y)?.closest('button, .leaflet-marker-icon')),
    }), point);
    expect(hit.intercepted, JSON.stringify({ point, hit })).toBe(false);
  }

  async expectSubmissionExpired(jobId: string): Promise<void> {
    await expect(this.pulses(jobId)).toHaveCount(0);
    await expect(this.activityPanel.locator('path.map-comet')).toHaveCount(0);
  }

  async expectStaticFeedback(jobId: string): Promise<void> {
    const feedback = this.pulses(jobId);
    expect(await feedback.count()).toBe(2);
    await expect(feedback.and(this.activityPanel.locator('[data-endpoint="source"]'))).toBeVisible();
    await expect(feedback.and(this.activityPanel.locator('[data-endpoint="destination"]'))).toBeVisible();
    expect(await feedback.evaluateAll(elements => elements.every(element =>
      getComputedStyle(element).opacity !== '0'
      && element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')))).toBe(true);
    await expect(this.activityPanel.locator('path.map-comet')).toHaveCount(0);
  }

  async expectNoEventFeedback(): Promise<void> {
    await expect(this.activityPanel.locator('.fleet-event-tag, .fleet-event-pulse, path.map-comet')).toHaveCount(0);
  }

  async resetToCaptured(hour: number): Promise<void> {
    await this.controls();
    await this.activityPanel.getByRole('button', { name: 'Reset model', exact: true }).click();
    // Reconstruction yields between canonical ticks; flush those tasks without skipping the brief event lifetime.
    await expect.poll(async () => {
      await this.activityPage.clock.runFor(1);
      return this.modelHour();
    }).toBe(hour);
  }
}
