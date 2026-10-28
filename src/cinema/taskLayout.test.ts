import { describe, expect, it } from 'vitest';
import { initialTaskLayout, reduceTaskLayout, type PanelLayout, type TaskLayout, type TaskLayoutEvent } from './taskLayout.ts';

const run = (state: TaskLayout, events: TaskLayoutEvent[], layout: PanelLayout | boolean) => {
  for (const event of events) state = reduceTaskLayout(state, event, layout).state;
  return state;
};

describe('task layout', () => {
  it('starts in Khám phá with the panel closed', () => {
    expect(initialTaskLayout()).toEqual({ task: 'explore', panel: 'closed', panelChoice: null });
    // Back from the inspector in seat selection: the side panel as the user left it.
    expect(initialTaskLayout('seats', null, false).panel).toBe('open');
    expect(initialTaskLayout('seats', null, true).panel).toBe('closed');
    expect(initialTaskLayout('seats', false, false).panel).toBe('closed');
  });

  it('opens the side panel with seat selection on wide screens, but not the sheet on phones', () => {
    expect(reduceTaskLayout(initialTaskLayout(), { type: 'task', task: 'seats' }, false).state.panel).toBe('open');
    expect(reduceTaskLayout(initialTaskLayout(), { type: 'task', task: 'seats' }, true).state.panel).toBe('closed');
  });

  it('hides the panel in other tasks and brings it back as the user left it', () => {
    let state = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }], true);
    expect(state).toEqual({ task: 'seats', panel: 'open', panelChoice: true });
    state = run(state, [{ type: 'task', task: 'watch' }], true);
    expect(state.panel).toBe('closed');
    expect(state.panelChoice).toBe(true);
    expect(run(state, [{ type: 'task', task: 'seats' }], true).panel).toBe('open');
    // Closed by the user: stays closed next time.
    state = run(state, [{ type: 'task', task: 'seats' }, { type: 'panel', open: false }, { type: 'task', task: 'explore' }, { type: 'task', task: 'seats' }], false);
    expect(state.panel).toBe('closed');
  });

  it('never opens the full-screen sheet by itself', () => {
    let state = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }, { type: 'expand', expanded: true }], true);
    expect(state.panel).toBe('expanded');
    state = run(state, [{ type: 'task', task: 'explore' }, { type: 'task', task: 'seats' }], true);
    expect(state.panel).toBe('open');
  });

  it('expands only a sheet that is open in seat selection', () => {
    const open = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }], false);
    expect(reduceTaskLayout(open, { type: 'expand', expanded: true }, false).state.panel).toBe('open');
    const closed = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }], true);
    expect(reduceTaskLayout(closed, { type: 'expand', expanded: true }, true).state.panel).toBe('closed');
  });

  it('steps out with Escape: full screen → sheet → closed', () => {
    let state = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }, { type: 'expand', expanded: true }], true);
    state = reduceTaskLayout(state, { type: 'escape' }, true).state;
    expect(state.panel).toBe('open');
    state = reduceTaskLayout(state, { type: 'escape' }, true).state;
    expect(state).toEqual({ task: 'seats', panel: 'closed', panelChoice: false });
    expect(reduceTaskLayout(state, { type: 'escape' }, true).state).toEqual(state);
  });

  it('clears a sheet out of the way for "Xem từ ghế này", but keeps a side panel', () => {
    const sheet = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }, { type: 'expand', expanded: true }], true);
    expect(reduceTaskLayout(sheet, { type: 'view-from-seat' }, true).state).toEqual({ task: 'seats', panel: 'closed', panelChoice: false });
    const side = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }], false);
    expect(reduceTaskLayout(side, { type: 'view-from-seat' }, false).state.panel).toBe('open');
  });

  it('leaves full screen when the screen turns into a side-panel layout', () => {
    const state = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }, { type: 'expand', expanded: true }], true);
    expect(reduceTaskLayout(state, { type: 'layout' }, false).state.panel).toBe('open');
    expect(reduceTaskLayout(state, { type: 'layout' }, true).state.panel).toBe('expanded');
  });

  it('on phones (immersive) the map is closed or full screen, never half a sheet', () => {
    expect(initialTaskLayout('seats', true, 'immersive').panel).toBe('closed');
    expect(reduceTaskLayout(initialTaskLayout(), { type: 'task', task: 'seats' }, 'immersive').state.panel).toBe('closed');
    let state = reduceTaskLayout(initialTaskLayout(), { type: 'panel', open: true }, 'immersive').state;
    expect(state).toEqual({ task: 'seats', panel: 'expanded', panelChoice: true });
    // "Mở rộng" does not apply; Escape and "Xem từ ghế này" close it outright.
    expect(reduceTaskLayout(state, { type: 'expand', expanded: false }, 'immersive').state.panel).toBe('expanded');
    expect(reduceTaskLayout(state, { type: 'escape' }, 'immersive').state).toEqual({ task: 'seats', panel: 'closed', panelChoice: false });
    expect(reduceTaskLayout(state, { type: 'view-from-seat' }, 'immersive').state.panel).toBe('closed');
    // Other tasks never bring it back by themselves.
    state = run(state, [{ type: 'task', task: 'watch' }], 'immersive');
    expect(reduceTaskLayout(state, { type: 'task', task: 'seats' }, 'immersive').state.panel).toBe('closed');
  });

  it('turns an open panel into the full-screen map on a phone, and back on a wider screen', () => {
    const open = run(initialTaskLayout(), [{ type: 'task', task: 'seats' }, { type: 'panel', open: true }], false);
    const phone = reduceTaskLayout(open, { type: 'layout' }, 'immersive').state;
    expect(phone.panel).toBe('expanded');
    expect(reduceTaskLayout(phone, { type: 'layout' }, 'side').state.panel).toBe('open');
    expect(reduceTaskLayout(phone, { type: 'layout' }, 'sheet').state.panel).toBe('expanded');
  });

  it('stops the tour and walking only when Khám phá is left', () => {
    const explore = initialTaskLayout();
    expect(reduceTaskLayout(explore, { type: 'task', task: 'watch' }, false).stopExploreActivities).toBe(true);
    expect(reduceTaskLayout(explore, { type: 'task', task: 'explore' }, false).stopExploreActivities).toBe(false);
    expect(reduceTaskLayout(explore, { type: 'panel', open: true }, false)).toEqual({
      state: { task: 'seats', panel: 'open', panelChoice: true },
      stopExploreActivities: true,
    });
    const watch = run(explore, [{ type: 'task', task: 'watch' }], false);
    expect(reduceTaskLayout(watch, { type: 'task', task: 'seats' }, false).stopExploreActivities).toBe(false);
  });
});
