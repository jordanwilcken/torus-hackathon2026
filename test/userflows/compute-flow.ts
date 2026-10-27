import type { Page } from '@playwright/test';
import type { ImpactView, JobInput } from './compute-flow.interface';

/**
 * Browser driver for the application that the team will implement.
 *
 * Scenario preparation must configure the real application with the matching
 * scenario inputs. Read methods must observe rendered application state. This
 * driver must not schedule work, calculate carbon, or supply expected results.
 * Each Playwright test has an isolated browser context; scenario setup must also
 * reset any state the eventual application keeps outside that context.
 *
 * These explicit failures keep the enabled flow tests RED until connected.
 * Only navigation is implemented; no product layout/selectors are prescribed.
 */
export class ComputeFlow {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  async useScenario(name: 'curtailed-solar' | 'stale-site'): Promise<void> {
    this.unimplemented(`configure the real ${name} scenario`);
  }

  async submitJob(job: JobInput): Promise<void> {
    this.unimplemented(`submit ${job.name} through the application`);
  }

  async executeAndCompare(): Promise<void> {
    this.unimplemented('execute the selected work and open the impact report');
  }

  async offeredSites(): Promise<string[]> {
    return this.unimplemented('read the offered sites from the map or offer list');
  }

  async selectedSite(): Promise<string | null> {
    return this.unimplemented('read the selected site');
  }

  async completedGpuHours(): Promise<number> {
    return this.unimplemented('read completed work');
  }

  async siteFreshness(site: string): Promise<'current' | 'stale' | 'unavailable'> {
    return this.unimplemented(`read ${site}'s evidence freshness`);
  }

  async recommendedNow(site: string): Promise<boolean> {
    return this.unimplemented(`read whether ${site} is recommended now`);
  }

  async impactReport(): Promise<ImpactView> {
    return this.unimplemented('read the displayed impact report');
  }

  private unimplemented(operation: string): never {
    throw new Error(`Unimplemented user-flow driver: ${operation}. Connect this to the real application.`);
  }
}
