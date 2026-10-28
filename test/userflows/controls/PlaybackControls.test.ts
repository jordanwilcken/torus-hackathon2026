import { expect, test, type Page } from '@playwright/test';
import type { PlaybackState } from '../../../src/ui/core/controls/PlaybackControls.types';
import type { PlaybackFixture } from './fixture';

declare global {
  interface Window { playbackFixture: PlaybackFixture }
}

const fixtureUrl = '/test/userflows/controls/fixture.html?view=controls';

test.beforeEach(async ({ page }) => {
  await page.goto(fixtureUrl);
  await expect(page.getByRole('region', { name: 'Simulation controls', exact: true })).toBeVisible();
});

async function supplyState(page: Page, patch: Partial<PlaybackState>) {
  await page.evaluate(patch => window.playbackFixture.setState(patch), patch);
}

async function callbackCalls(page: Page) {
  return page.evaluate(() => window.playbackFixture.calls());
}

test('play, pause, step and reset display the controller state returned by each command', async ({ page }) => {
  const controls = page.getByRole('region', { name: 'Simulation controls', exact: true });
  await expect(controls.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 24');
  await expect(controls.getByLabel('Playback status', { exact: true })).toContainText(/paused/i);

  await controls.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(controls.getByLabel('Playback status', { exact: true })).toContainText(/playing/i);
  await expect(controls.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(controls.getByLabel('Playback status', { exact: true })).toContainText(/paused/i);
  await controls.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(controls.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
  await expect(controls.getByLabel('Simulation time', { exact: true })).toContainText('2026-10-28T13:00:00.000Z');
  await expect(controls.getByRole('status').filter({ hasText: 'Advanced to hour 1.' })).toBeVisible();
  await controls.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(controls.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 24');
  await expect(controls.getByLabel('Simulation time', { exact: true })).toContainText('2026-10-28T12:00:00Z');
  expect(await callbackCalls(page)).toEqual([
    { action: 'play' }, { action: 'pause' }, { action: 'step' }, { action: 'reset' },
  ]);
});

test('the selected playback speed is supplied to the controller and retained in the view', async ({ page }) => {
  const speed = page.getByRole('combobox', { name: 'Playback speed', exact: true });
  await speed.selectOption('4');
  await expect(speed).toHaveValue('4');
  expect(await callbackCalls(page)).toEqual([{ action: 'setSpeed', input: 4 }]);
});

test('all four scenario choices forward their supplied event payload without changing it', async ({ page }) => {
  const scenario = page.getByRole('combobox', { name: 'Scenario event', exact: true });
  const apply = page.getByRole('button', { name: 'Apply event', exact: true });

  await scenario.selectOption('forecast-error');
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted event forecast-error for hour 2.' })).toBeVisible();
  await scenario.selectOption('site-outage');
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted event site-outage for hour 2.' })).toBeVisible();
  await scenario.selectOption('utility-import-limit');
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted event utility-import-limit for hour 2.' })).toBeVisible();
  await scenario.selectOption('reserve-change');
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted event reserve-change for hour 2.' })).toBeVisible();

  expect((await callbackCalls(page)).filter(call => call.action === 'applyEvent')).toEqual([
    { action: 'applyEvent', input: { atHour: 2, kind: 'forecast-error', payload: { regionalScope: 'PACE', carbonMultiplier: 1.4 } } },
    { action: 'applyEvent', input: { atHour: 2, kind: 'site-outage', payload: { locationId: 'utah-solar' } } },
    { action: 'applyEvent', input: { atHour: 2, kind: 'utility-import-limit', payload: { locationId: 'utah-grid', limitKW: 2 } } },
    { action: 'applyEvent', input: { atHour: 2, kind: 'reserve-change', payload: { locationId: 'utah-solar', protectedKWh: 3 } } },
  ]);
});

test('stale, infeasible and rejected-event messages retain the supplied explanation', async ({ page }) => {
  const controls = page.getByRole('region', { name: 'Simulation controls', exact: true });
  await supplyState(page, { condition: { kind: 'stale', message: 'Forecast retrieved at 12:00; awaiting refresh.' } });
  await expect(controls).toContainText('Forecast retrieved at 12:00; awaiting refresh.');
  await supplyState(page, { condition: { kind: 'infeasible', message: 'The fixed load exceeds this site import limit.' } });
  await expect(controls).toContainText('The fixed load exceeds this site import limit.');
  await supplyState(page, { response: { kind: 'error', message: 'Event rejected: hour 2 has already executed.' } });
  await expect(controls.getByRole('alert').filter({ hasText: 'Event rejected: hour 2 has already executed.' })).toBeVisible();
});

test('an unresolved command blocks duplicate and competing commands until it settles', async ({ page }) => {
  await page.evaluate(() => window.playbackFixture.holdNextStep());
  const step = page.getByRole('button', { name: 'Step', exact: true });
  await step.click();
  await expect(step).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply event', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Playback speed', exact: true })).toBeDisabled();
  await step.press('Enter');
  expect(await callbackCalls(page)).toEqual([{ action: 'step' }]);

  await page.evaluate(() => window.playbackFixture.releaseStep());
  await expect(step).toBeEnabled();
  await expect(page.getByLabel('Simulation hour', { exact: true })).toHaveText('1 / 24');
});

test('an externally busy controller disables commands without dispatching a callback', async ({ page }) => {
  await supplyState(page, { busy: true });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply event', exact: true })).toBeDisabled();
  expect(await callbackCalls(page)).toEqual([]);
  await supplyState(page, { busy: false });
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
});

test('playing can be paused while the supplied controller is processing a tick', async ({ page }) => {
  await supplyState(page, { mode: 'playing', busy: true });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await pause.click();
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('paused');
  await expect(page.getByRole('status').filter({ hasText: 'Playback paused.' })).toBeVisible();
  expect(await callbackCalls(page)).toEqual([{ action: 'pause' }]);
});

test('pause interrupts playing while the Play acknowledgement is still pending', async ({ page }) => {
  await page.evaluate(() => window.playbackFixture.holdNextPlay());
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('playing');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeEnabled();
  await pause.click();
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('paused');
  expect(await callbackCalls(page)).toEqual([{ action: 'play' }, { action: 'pause' }]);

  await page.evaluate(() => window.playbackFixture.releasePlay());
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('paused');
});

test('a command acknowledgement cannot invent a new simulation hour or playback state', async ({ page }) => {
  await page.evaluate(() => window.playbackFixture.suppressNextStateUpdate());
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 24');
  await expect(page.getByLabel('Simulation time', { exact: true })).toHaveText('2026-10-28T12:00:00Z');
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('paused');
  expect(await callbackCalls(page)).toEqual([{ action: 'step' }]);
});

test('a failed command displays its rejection and permits a later successful command', async ({ page }) => {
  await page.evaluate(() => window.playbackFixture.rejectNextCommand());
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The supplied command failed.');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Advanced to hour 1.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('completed playback prevents additional work while reset remains available', async ({ page }) => {
  await supplyState(page, { hour: 24, mode: 'complete', currentTime: '2026-10-29T12:00:00Z' });
  await expect(page.getByLabel('Simulation hour', { exact: true })).toHaveText('24 / 24');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply event', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Playback status', { exact: true })).toContainText(/paused/i);
  await expect(page.getByLabel('Simulation hour', { exact: true })).toHaveText('0 / 24');
});

test('an empty scenario menu cannot apply an invented event', async ({ page }) => {
  await page.evaluate(() => window.playbackFixture.emptyEvents());
  await expect(page.getByRole('combobox', { name: 'Scenario event', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply event', exact: true })).toBeDisabled();
  expect(await callbackCalls(page)).toEqual([]);
});

test('controls remain usable from the keyboard in a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = page.getByRole('region', { name: 'Simulation controls', exact: true });
  await controls.getByRole('button', { name: 'Play', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(controls.getByLabel('Playback status', { exact: true })).toContainText(/playing/i);
  await controls.getByRole('button', { name: 'Pause', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(controls.getByLabel('Playback status', { exact: true })).toContainText(/paused/i);
  await expect(controls.getByRole('combobox', { name: 'Scenario event', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
