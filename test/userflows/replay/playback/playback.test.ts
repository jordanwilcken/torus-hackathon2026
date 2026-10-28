import { expect, test } from '@playwright/test';
import { PlaybackFlow } from './playback-flow';

test('existing callers remain paused initially and retain the 1000ms tick plus 650ms routed hold', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open();
    await flow.expectPhase('ready', 0);
    await flow.expectPlaying(false);
    await flow.advance(10_000);
    await flow.expectPhase('ready', 0);
    await flow.play();
    await flow.advance(999);
    await flow.expectPhase('ready', 0);
    await flow.advance(1);
    await flow.expectPhase('routed', 0);
    await flow.expectBusy(true);
    await flow.advance(649);
    await flow.expectPhase('routed', 0);
    await flow.advance(1);
    await flow.expectPhase('settled', 1);
    await flow.expectBusy(false);
    await flow.pause();
    await flow.advance(10_000);
    await flow.expectPhase('settled', 1);
});

test('configured autoplay waits 4000ms then holds the actual routed publication for 1800ms', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: true, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 1 });
    await flow.advance(3999);
    await flow.expectPhase('ready', 0);
    await flow.expectCompleted(false);
    await flow.advance(1);
    await flow.expectPhase('routed', 0);
    await flow.expectPlaying(true);
    await flow.expectBusy(true);
    await flow.expectPublications('0');
    await flow.advance(1799);
    await flow.expectPhase('routed', 0);
    await flow.advance(1);
    await flow.expectPhase('settled', 1);
    await flow.expectBusy(false);
});

test('initial speed 4 scales configured tick and routed waits to 1000ms and 450ms', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: true, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 4 });
    await flow.expectSpeed(4);
    await flow.advance(999);
    await flow.expectPhase('ready', 0);
    await flow.advance(1);
    await flow.expectPhase('routed', 0);
    await flow.advance(449);
    await flow.expectPhase('routed', 0);
    await flow.advance(1);
    await flow.expectPhase('settled', 1);
    await flow.expectBusy(false);
});

test('Pause cancels the queued tick and settles one in-flight atomic hour without hidden advancement', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: true, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 1 });
    await flow.advance(2000);
    await flow.pause();
    await flow.expectAcknowledged('Pause');
    await flow.expectPlaying(false);
    await flow.advance(20_000);
    await flow.expectPhase('ready', 0);
    // Pause arrives in the same JavaScript turn, before the asynchronous routed callback installs its hold.
    await flow.stepAndPause();
    await flow.expectAcknowledged('Step and pause');
    await flow.expectPhase('settled', 1);
    await flow.expectPlaying(false);
    await flow.expectBusy(false);
    await flow.play();
    await flow.advance(4000);
    await flow.expectPhase('routed', 1);
    await flow.pause();
    await flow.expectAcknowledged('Pause');
    await flow.expectPhase('settled', 2);
    await flow.expectPlaying(false);
    await flow.expectBusy(false);
    await flow.advance(20_000);
    await flow.expectPhase('settled', 2);
    await flow.expectNoError();
});

test('Reset cancels queued and routed work; an old completion cannot clear a fresh step busy guard', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: true, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 1 });
    await flow.advance(2000);
    await flow.reset();
    await flow.expectAcknowledged('Reset');
    await flow.expectPhase('ready', 0);
    await flow.expectPlaying(false);
    await flow.expectPublications('none');
    await flow.advance(20_000);
    await flow.expectPhase('ready', 0);

    await flow.step();
    await flow.expectPhase('routed', 0);
    await flow.advance(1800);
    await flow.expectPhase('settled', 1);
    await flow.step();
    await flow.expectPhase('routed', 1);
    await flow.resetAndStep();
    await flow.expectPhase('routed', 0);
    await flow.expectPlaying(false);
    await flow.expectBusy(true);
    await flow.expectSelectedWork(0);
    await flow.expectNoError();
    // Public Step is invoked while the new step owns the guard. The old generation must not unlock it.
    await flow.step();
    await flow.expectPhase('routed', 0);
    await flow.expectBusy(true);
    await flow.expectNoError();
    await flow.advance(1799);
    await flow.expectPhase('routed', 0);
    await flow.expectBusy(true);
    await flow.advance(1);
    await flow.expectPhase('settled', 1);
    await flow.expectBusy(false);
    await flow.expectAcknowledged('Reset and step');
    await flow.advance(20_000);
    await flow.expectPhase('settled', 1);
    await flow.expectCompleted(false);
});

test('one-times and four-times playback produce byte-identical raw replay evidence', async ({ page, browser, baseURL }) => {
    // Page.clock is owned by BrowserContext, so each playback speed needs its own clock/context.
    const fastContext = await browser.newContext({ baseURL });
    try {
        const fastPage = await fastContext.newPage();
        const normal = new PlaybackFlow(page);
        const fast = new PlaybackFlow(fastPage);
        await normal.open({ autoPlay: false, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 1 });
        await fast.open({ autoPlay: false, tickMs: 4000, routedDwellMs: 1800, initialSpeed: 4 });
        await normal.expectSpeed(1);
        await fast.expectSpeed(4);
        await normal.play();
        await fast.play();
        for (let hour = 1; hour <= 4; hour++) {
            await normal.advance(4000);
            await normal.expectPhase('routed', hour - 1);
            await normal.advance(1800);
            await normal.expectPhase(hour === 4 ? 'complete' : 'settled', hour);
            await fast.advance(1000);
            await fast.expectPhase('routed', hour - 1);
            await fast.advance(450);
            await fast.expectPhase(hour === 4 ? 'complete' : 'settled', hour);
        }
        await normal.expectPlaying(false);
        await fast.expectPlaying(false);
        await normal.expectSelectedWork(3);
        await fast.expectSelectedWork(3);
        expect(await fast.evidence()).toBe(await normal.evidence());
    } finally {
        await fastContext.close();
    }
});

test('Pause then read in the same command captures the settled hour and retains a detached moment', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: false, tickMs: 4000, routedDwellMs: 1800 });
    await flow.step();
    await flow.expectPhase('routed', 0);
    await flow.pauseAndCapture();
    await flow.expectAcknowledged('Pause and capture');
    const frozen = await flow.savedMoment();
    expect(frozen.hour).toBe(1);
    expect(frozen.phase).toBe('settled');
    expect(frozen.selected.run.ticks).toHaveLength(1);
    await flow.expectPlaying(false);
    await flow.step();
    await flow.advance(1800);
    await flow.expectPhase('settled', 2);
    expect(await flow.savedMoment()).toEqual(frozen);
    await flow.reset();
    await flow.expectAcknowledged('Reset');
    await flow.expectPhase('ready', 0);
    expect(await flow.savedMoment()).toEqual(frozen);
    await flow.expectNoError();
});

test('a session captured at hour 2 resumes at 2 and Reset restores its original receipts and prior events', async ({ page }) => {
    const flow = new PlaybackFlow(page);
    await flow.open({ autoPlay: false, tickMs: 4000, routedDwellMs: 1800 }, 'hour-2');
    await flow.expectPhase('settled', 2);
    await flow.expectPlaying(false);
    const initial = await flow.currentMoment();
    expect(initial.baseline.run.ticks).toHaveLength(2);
    expect(initial.selected.run.ticks).toHaveLength(2);
    expect(initial.scenario.events).toEqual([{ kind: 'solar-drop', atHour: 1, payload: { locationId: 'A' } }]);
    await flow.injectFreshEvent();
    await flow.expectAcknowledged('Inject fresh event');
    expect((await flow.currentMoment()).scenario.events).toHaveLength(2);
    await flow.step();
    await flow.advance(1800);
    await flow.expectPhase('settled', 3);
    expect((await flow.currentMoment()).selected.run.ticks).toHaveLength(3);
    await flow.reset();
    await flow.expectAcknowledged('Reset');
    await flow.expectPhase('settled', 2);
    await flow.expectPlaying(false);
    expect(await flow.currentMoment()).toEqual(initial);
    await flow.advance(20_000);
    await flow.expectPhase('settled', 2);
    await flow.expectNoError();
});
