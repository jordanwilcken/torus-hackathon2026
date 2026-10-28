import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { MoveSignal } from '../../../src/ui/fleet/EngineSignals';

test('a rejected destination is identified as an alternative, not the site where the job stays', () => {
  const markup = renderToStaticMarkup(createElement(MoveSignal, {
    destinationName: 'Sacramento',
    decision: { move: false, destinationLocationId: 'C', transferCarbonKg: .001,
      netCarbonReductionKg: .02, reason: 'Destination execution plus transfer is not cheaper.' },
  }));
  expect(markup).toContain('Alternative rejected');
  expect(markup).toContain('Sacramento');
  expect(markup).not.toContain('● Stay');
  expect(markup).not.toContain('net carbon benefit');
});

test('a feasible move assessment alone is not presented as an accepted transfer', () => {
  const markup = renderToStaticMarkup(createElement(MoveSignal, {
    destinationName: 'Cedar City',
    decision: { move: true, destinationLocationId: 'B', transferCarbonKg: .001,
      reason: 'A feasible destination can rescue the deadline; carbon savings are unavailable.' },
  }));
  expect(markup).toContain('Transfer proposed');
  expect(markup).not.toContain('Transfer accepted');
  expect(markup).not.toContain('net carbon benefit');
});

test('a rejected transfer receipt overrides the favorable proposal in the displayed action', () => {
  const markup = renderToStaticMarkup(createElement(MoveSignal, {
    destinationName: 'Cedar City',
    decision: { move: true, destinationLocationId: 'B', transferCarbonKg: .001,
      netCarbonReductionKg: .02, reason: 'The assessed remaining job would be cleaner.' },
    transfer: { started: false, explanation: 'Destination capacity changed before acceptance.' },
  }));
  expect(markup).toContain('Transfer not started');
  expect(markup).toContain('Destination capacity changed before acceptance.');
  expect(markup).not.toContain('estimated net carbon reduction');
});
