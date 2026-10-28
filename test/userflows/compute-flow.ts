import type { Page } from '@playwright/test';
import type { ImpactView, JobInput } from './compute-flow.interface';

function numberFromAttribute(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid numeric value rendered by the application: ' + value);
  return number;
}

/** Supplies scenario inputs and observes rendered values; it does not calculate product results. */
export class ComputeFlow {
  private mapTilesMocked = false;

  constructor(private readonly page: Page) {}

  private async mockMapTiles(): Promise<void> {
    if (this.mapTilesMocked) return;
    await this.page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9efeb"/></svg>',
    }));
    this.mapTilesMocked = true;
  }

  async open(): Promise<void> {
    await this.mockMapTiles();
    await this.page.goto('/');
  }

  async useScenario(name: 'curtailed-solar' | 'stale-site' | 'recorded-comparison'): Promise<void> {
    if (name === 'curtailed-solar') this.unimplemented(`configure the real ${name} scenario`);
    await this.mockMapTiles();
    await this.page.goto('/?scenario=' + encodeURIComponent(name));
  }

  async submitJob(job: JobInput): Promise<void> {
    this.unimplemented(`submit ${job.name} through the application`);
  }

  async executeAndCompare(): Promise<void> {
    this.unimplemented('execute the selected work and open the impact report');
  }

  async postedPrices(): Promise<Array<{ site: string; usdPerGpuHour: number }>> {
    return this.unimplemented('read the sites and posted hourly prices from the map or price board');
  }

  async selectedSite(): Promise<string | null> {
    return this.unimplemented('read the selected site');
  }

  async completedGpuHours(): Promise<number> {
    const report = this.page.getByRole('region', { name: 'Job report', exact: true });
    const completed = numberFromAttribute(await report.getAttribute('data-completed-gpu-h'));
    if (completed === null) throw new Error('Completed work is unavailable in the rendered report.');
    return completed;
  }

  async siteFreshness(site: string): Promise<'current' | 'stale' | 'unavailable'> {
    const picker = this.page.locator('button[data-location-id=' + JSON.stringify(site) + '][data-site-freshness]');
    const freshness = await picker.getAttribute('data-site-freshness');
    if (freshness !== 'current' && freshness !== 'stale' && freshness !== 'unavailable') {
      throw new Error('Missing site freshness for ' + site);
    }
    return freshness;
  }

  async recommendedNow(site: string): Promise<boolean> {
    const picker = this.page.locator('button[data-location-id=' + JSON.stringify(site) + '][data-available-now]');
    const available = await picker.getAttribute('data-available-now');
    if (available !== 'true' && available !== 'false') throw new Error('Missing current availability for ' + site);
    return available === 'true';
  }

  async impactReport(): Promise<ImpactView> {
    const report = this.page.getByRole('region', { name: 'Job report', exact: true });
    if (await report.locator('details.report-details').getAttribute('open') === null) {
      await report.getByText('Report details', { exact: true }).click();
    }
    const table = report.getByRole('table', { name: 'Observed impact report' });
    const values = async (measure: RegExp) => {
      const cells = table.getByRole('row', { name: measure }).getByRole('cell');
      return [numberFromAttribute(await cells.nth(0).getAttribute('data-value')),
        numberFromAttribute(await cells.nth(1).getAttribute('data-value'))];
    };
    const [baselineCarbonKg, selectedCarbonKg] = await values(/Carbon/);
    const [baselineModeledCostUsd, selectedModeledCostUsd] = await values(/Modeled cost/);
    const [baselineElectricityUsd, selectedElectricityUsd] = await values(/Electricity/);
    const differences = report.getByRole('region', { name: 'Impact differences', exact: true });
    const difference = async (name: string) => numberFromAttribute(await differences.getByText(name, { exact: true })
      .locator('..').locator('dd').getAttribute('data-value'));
    return {
      comparable: await report.getByText('Comparison: comparable', { exact: true }).count() === 1,
      baselineCarbonKg, selectedCarbonKg, baselineModeledCostUsd, selectedModeledCostUsd,
      baselineElectricityUsd, selectedElectricityUsd,
      reductionKg: await difference('Carbon reduction'),
      modeledCostReductionUsd: await difference('Modeled cost reduction'),
      completedGpuH: await this.completedGpuHours(),
    };
  }

  private unimplemented(operation: string): never {
    throw new Error(`Unimplemented user-flow driver: ${operation}. Connect this to the real application.`);
  }
}
