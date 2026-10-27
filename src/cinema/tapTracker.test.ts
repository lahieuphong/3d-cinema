import { describe, expect, it } from 'vitest';
import { createAuditoriumLayout } from './layout.ts';
import { TapTracker } from './tapTracker.ts';

const { config } = createAuditoriumLayout();
const tracker = () => new TapTracker({ slopPx: config.selection.tapSlopPx, maxMs: config.selection.tapMaxMs });

/** One canvas press from down to up, with the page-wide bookkeeping the view does. */
function press(t: TapTracker, id: number, type: string, path: Array<[number, number]>, ms = 120, button = 0): boolean {
  t.anyDown(id);
  t.down(id, type, button, ...path[0], 0);
  for (const [x, y] of path.slice(1)) t.move(id, x, y);
  const tap = t.up(id, ...path.at(-1)!, ms);
  t.anyUp(id);
  return tap;
}

describe('tap tracker', () => {
  it('accepts a still click or tap, within the slop for its pointer type', () => {
    const t = tracker();
    expect(press(t, 1, 'mouse', [[100, 100], [102, 101]])).toBe(true);
    expect(press(t, 2, 'touch', [[100, 100], [108, 104]])).toBe(true);
    // The same 9 px is a drag for a mouse but still a tap for a finger.
    expect(press(t, 3, 'mouse', [[100, 100], [109, 100]])).toBe(false);
    expect(press(t, 4, 'touch', [[100, 100], [109, 100]])).toBe(true);
  });

  it('rejects drags that come back to the start, long presses and secondary buttons', () => {
    const t = tracker();
    expect(press(t, 1, 'mouse', [[100, 100], [160, 100], [100, 100]])).toBe(false);
    expect(press(t, 2, 'touch', [[100, 100]], config.selection.tapMaxMs + 1)).toBe(false);
    expect(press(t, 3, 'mouse', [[100, 100]], 100, 2)).toBe(false);
  });

  it('never makes a tap out of a multi-pointer gesture, including the finger lifted last', () => {
    const t = tracker();
    // Two fingers on the canvas (pinch / two-finger pan), lifted one by one.
    t.anyDown(1);
    t.down(1, 'touch', 0, 100, 100, 0);
    t.anyDown(2);
    t.down(2, 'touch', 0, 200, 100, 10);
    expect(t.up(2, 200, 100, 100)).toBe(false);
    t.anyUp(2);
    expect(t.up(1, 100, 100, 120)).toBe(false);
    t.anyUp(1);
    // Thumb on the explore stick (not the canvas) while another finger taps the canvas.
    t.anyDown(7);
    expect(press(t, 8, 'touch', [[300, 300]])).toBe(false);
    t.anyUp(7);
    // Everything released: the next tap works again.
    expect(press(t, 9, 'touch', [[300, 300]])).toBe(true);
  });

  it('drops presses on pointercancel and blur, and the press that stopped the tour', () => {
    const t = tracker();
    t.anyDown(1);
    t.down(1, 'touch', 0, 100, 100, 0);
    t.cancel(1);
    expect(t.up(1, 100, 100, 50)).toBe(false);
    t.anyDown(2);
    t.down(2, 'mouse', 0, 100, 100, 0);
    t.cancelAll();
    expect(t.up(2, 100, 100, 50)).toBe(false);
    t.anyDown(3);
    t.down(3, 'mouse', 0, 100, 100, 0, true);
    expect(t.up(3, 100, 100, 50)).toBe(false);
    t.anyUp(3);
    expect(press(t, 4, 'mouse', [[100, 100]])).toBe(true);
  });
});
