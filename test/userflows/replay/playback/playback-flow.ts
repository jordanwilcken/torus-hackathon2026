import { expect, type Page } from '@playwright/test';
import type { ReplayPlaybackOptions } from '../../../../src/ui/replay/useReplayPlayback';

/** Advances presentation time and reads actual hook publications; no engine result is reconstructed. */
export class PlaybackFlow {
    constructor(private readonly page: Page) {}

    async open(options?: ReplayPlaybackOptions): Promise<void> {
        const start = Date.parse('2026-10-28T18:00:00Z');
        await this.page.clock.install({ time: start });
        const query = new URLSearchParams(options === undefined ? { profile: 'defaults' } : Object.fromEntries(
            Object.entries(options).map(([key, value]) => [key, String(value)])));
        await this.page.goto('/test/userflows/replay/playback/fixture.html?' + query);
        // There is no mounted hook yet, so freezing here cannot consume a playback tick during page loading.
        await this.page.clock.pauseAt(start + 60_000);
        await this.page.getByRole('button', { name: 'Mount playback', exact: true }).click();
        await expect(this.page.getByRole('region', { name: 'Playback observation', exact: true })).toBeVisible();
    }

    async advance(milliseconds: number): Promise<void> {
        await this.page.clock.runFor(milliseconds);
    }

    async play(): Promise<void> { await this.page.getByRole('button', { name: 'Play', exact: true }).click(); }
    async pause(): Promise<void> { await this.page.getByRole('button', { name: 'Pause', exact: true }).click(); }
    async step(): Promise<void> { await this.page.getByRole('button', { name: 'Step', exact: true }).click(); }
    async stepAndPause(): Promise<void> { await this.page.getByRole('button', { name: 'Step and immediately pause', exact: true }).click(); }
    async reset(): Promise<void> { await this.page.getByRole('button', { name: 'Reset', exact: true }).click(); }
    async resetAndStep(): Promise<void> { await this.page.getByRole('button', { name: 'Reset and start fresh step', exact: true }).click(); }

    async expectPhase(phase: string, hour: number): Promise<void> {
        await expect(this.page.getByLabel('Observed phase', { exact: true })).toHaveText(phase);
        await expect(this.page.getByLabel('Observed hour', { exact: true })).toHaveText(String(hour));
    }
    async expectPlaying(playing: boolean): Promise<void> {
        await expect(this.page.getByLabel('Observed playing', { exact: true })).toHaveText(String(playing));
    }
    async expectBusy(busy: boolean): Promise<void> {
        await expect(this.page.getByLabel('Observed busy', { exact: true })).toHaveText(String(busy));
    }
    async expectSpeed(speed: number): Promise<void> {
        await expect(this.page.getByLabel('Observed speed', { exact: true })).toHaveText(String(speed));
    }
    async expectCompleted(completed: boolean): Promise<void> {
        await expect(this.page.getByLabel('Observed completed', { exact: true })).toHaveText(String(completed));
    }
    async expectPublications(hours: string): Promise<void> {
        await expect(this.page.getByLabel('Observed publications', { exact: true })).toHaveText(hours);
    }
    async expectSelectedWork(gpuHours: number): Promise<void> {
        await expect(this.page.getByLabel('Observed selected work', { exact: true })).toHaveText(String(gpuHours));
    }
    async expectAcknowledged(command: string): Promise<void> {
        await expect(this.page.getByLabel('Command acknowledgement', { exact: true })).toHaveText(`${command} acknowledged`);
    }
    async expectNoError(): Promise<void> {
        await expect(this.page.getByLabel('Command error', { exact: true })).toHaveText('none');
        await expect(this.page.getByLabel('Observed response kind', { exact: true })).not.toHaveText('error');
    }
    async evidence(): Promise<string> {
        await this.expectCompleted(true);
        return await this.page.getByLabel('Completed evidence', { exact: true }).textContent() ?? '';
    }
}
