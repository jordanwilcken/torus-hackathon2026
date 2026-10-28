import { expect, type Locator, type Page } from '@playwright/test';

/** Operates the actual replay page and inspects the rendered map; no engine result is supplied. */
export class CompactReplayFlow {
    private readonly replay: Locator;
    private readonly map: Locator;
    private readonly controls: Locator;

    constructor(private readonly page: Page) {
        this.replay = page.getByRole('region', { name: 'Paired replay', exact: true });
        this.map = this.replay.getByRole('region', { name: 'US energy map', exact: true });
        this.controls = this.replay.getByRole('region', { name: 'Simulation controls', exact: true });
    }

    async open(): Promise<void> {
        await this.page.route(/^https:\/\/(?:[a-z]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ea"/></svg>',
        }));
        await this.page.goto('/?scenario=paired-replay');
        await expect(this.replay).toBeVisible();
        await expect(this.map).toBeVisible();
    }

    async showUS(): Promise<void> {
        await this.map.getByRole('button', { name: 'Show US', exact: true }).click();
    }

    async expectSmallPins(maximumPixels: number): Promise<void> {
        const pins = this.map.locator('button.map-pin');
        await expect(pins).not.toHaveCount(0);
        for (const pin of await pins.all()) {
            await expect(pin).toBeEnabled();
            const bounds = await pin.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.width).toBeLessThanOrEqual(maximumPixels);
            expect(bounds!.height).toBeLessThanOrEqual(maximumPixels);
        }
    }

    async previewRegionName(name: string): Promise<void> {
        const pin = this.map.getByRole('button', { name: `Inspect ${name} region`, exact: true });
        await pin.hover();
        await expect(pin.locator('strong')).toBeVisible();
        await expect(pin.locator('strong')).toHaveText(name);
        for (const caption of await pin.locator('span:not(.job-assignment), small').all())
            await expect(caption).toBeHidden();
        await expect(this.map.getByRole('region', { name: 'Regional overview', exact: true })).toHaveCount(0);
    }

    async inspectRegion(name: string): Promise<void> {
        await this.map.getByRole('button', { name: `Inspect ${name} region`, exact: true }).click();
        const details = this.map.getByRole('region', { name: 'Regional overview', exact: true });
        await expect(details).toContainText(name);
        await this.expectBelowCanvas(details);
    }

    private async expectBelowCanvas(details: Locator): Promise<void> {
        await expect(details).toBeVisible();
        const canvas = await this.map.locator('.map-canvas').boundingBox();
        const panel = await details.boundingBox();
        expect(canvas).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(panel!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);
    }

    async showUtah(): Promise<void> {
        await this.map.getByRole('button', { name: 'Explore Utah', exact: true }).click();
    }

    async inspectSite(name: string, maximumPinPixels: number): Promise<void> {
        const pin = this.map.getByRole('button', { name: `Inspect ${name}`, exact: true });
        await expect(pin).toBeVisible();
        const bounds = await pin.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeLessThanOrEqual(maximumPinPixels);
        expect(bounds!.height).toBeLessThanOrEqual(maximumPinPixels);
        await pin.click();
    }

    private get priceDetails(): Locator {
        return this.map.getByRole('region', { name: 'Price details', exact: true });
    }

    private disclosure(label: string): Locator {
        return this.map.locator('details').filter({ has: this.page.locator('summary').filter({ hasText: label }) });
    }

    async expectCollapsedSiteInformation(name: string): Promise<void> {
        await expect(this.priceDetails.getByRole('heading', { level: 3 })).toContainText(name);
        await expect(this.priceDetails.getByText('USD / GPU-hour', { exact: true })).toBeVisible();
        await expect(this.disclosure('Price evidence')).toHaveJSProperty('open', false);
        await expect(this.disclosure('Site energy details')).toHaveJSProperty('open', false);
        await expect(this.priceDetails.getByText('Simulated site inputs', { exact: true })).toBeHidden();
        await expect(this.map.getByText('Solar supplied', { exact: true })).toBeHidden();
        await this.expectBelowCanvas(this.priceDetails);
    }

    async expandSiteInformation(): Promise<void> {
        const evidence = this.disclosure('Price evidence');
        await evidence.locator('summary').click();
        await expect(evidence).toHaveJSProperty('open', true);
        await expect(this.priceDetails.getByText('Simulated site inputs', { exact: true })).toBeVisible();
        await expect(this.priceDetails.getByText('Version', { exact: true })).toBeVisible();
        const energy = this.disclosure('Site energy details');
        await energy.locator('summary').click();
        await expect(energy).toHaveJSProperty('open', true);
        await expect(energy.getByText('Solar supplied', { exact: true })).toBeVisible();
        await expect(energy.getByText('Storage capacity', { exact: true })).toBeVisible();
        const inspection = this.map.locator('.map-inspection-card');
        await this.expectBelowCanvas(inspection);
        const bounds = await inspection.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
    }

    async expectReplayHour(hour: number, total: number): Promise<void> {
        await expect(this.replay.getByLabel('Replay hour', { exact: true })).toHaveText(`${hour} / ${total}`);
    }

    async stepReplayTo(hour: number): Promise<void> {
        if (!await this.controls.isVisible())
            await this.replay.getByRole('button', { name: 'Chaos monkey', exact: true }).click();
        await this.controls.getByRole('button', { name: 'Step', exact: true }).click();
        await this.expectReplayHour(hour, 4);
        await expect(this.controls.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
    }

    async closeReplayControls(): Promise<void> {
        await this.replay.getByRole('button', { name: 'Close chaos monkey', exact: true }).click();
        await expect(this.replay.getByRole('dialog', { name: 'Chaos monkey', exact: true })).toBeHidden();
    }

    async expectImpactOutsideMap(): Promise<void> {
        const impact = this.replay.getByRole('region', { name: 'Job impact', exact: true });
        await expect(impact).toBeVisible();
        await expect(impact).toContainText('Planned energy');
        await expect(impact).toContainText('Modeled cost change');
        await expect(this.map.getByRole('region', { name: 'Job impact', exact: true })).toHaveCount(0);
        await this.expectBelowCanvas(impact);
    }

    async dismissInspection(): Promise<void> {
        await this.page.keyboard.press('Escape');
        await expect(this.map.getByRole('button', { name: 'Close details', exact: true })).toHaveCount(0);
        await expect(this.map).toBeVisible();
    }
}
