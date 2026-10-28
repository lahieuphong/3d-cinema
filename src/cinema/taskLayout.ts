/**
 * The page's three tasks and where the seat panel is, as one small state machine. It only decides
 * what is shown; the page applies the result. Tasks are presentations of one page: they share the
 * scene, renderer, camera, seat selection, film element and quality, and switching never touches
 * any of them (no new canvas or listeners, no camera move, no playback change).
 */
export type CinemaTask = 'explore' | 'seats' | 'watch';

/** Screens where the seat panel is a sheet under the view rather than a side panel (same as the CSS). */
export const SHEET_LAYOUT_QUERY = '(orientation: portrait) and (max-width: 1024px)';

/**
 * Phones, upright or on their side: the room fills the screen and every control sits in the
 * floating control hub (`data-layout="immersive"`; the CSS keys off that attribute).
 */
export const IMMERSIVE_LAYOUT_QUERY = '(max-width: 599px), (orientation: landscape) and (max-height: 500px)';

/**
 * Where the seat panel goes: beside the view (`side`), as a sheet under it (`sheet`), or, on phones
 * (`immersive`), only ever as the full-screen map: there is no room for half a map over the scene.
 */
export type PanelLayout = 'side' | 'sheet' | 'immersive';

export const CINEMA_TASKS: ReadonlyArray<{ id: CinemaTask; label: string }> = [
  { id: 'explore', label: 'Khám phá' },
  { id: 'seats', label: 'Chọn ghế' },
  { id: 'watch', label: 'Xem phim' },
];

/**
 * The seat panel: `closed`; `open` (a side panel next to the view, or on portrait screens a sheet
 * under it that leaves the room visible above); `expanded` (sheet layouts only: the map fills the
 * screen as a modal dialog until the user goes back to the room).
 */
export type PanelState = 'closed' | 'open' | 'expanded';

export interface TaskLayout {
  task: CinemaTask;
  panel: PanelState;
  /** The user's last choice for the panel (open or closed); null until they make one. */
  panelChoice: boolean | null;
}

export type TaskLayoutEvent =
  | { type: 'task'; task: CinemaTask }
  /** "Sơ đồ ghế" / "Mở sơ đồ", "Đóng", "Trở lại phòng 3D". */
  | { type: 'panel'; open: boolean }
  /** "Mở rộng" / "Thu nhỏ" on a sheet. */
  | { type: 'expand'; expanded: boolean }
  /** Escape inside the panel: out of the full-screen sheet first, then closed. */
  | { type: 'escape' }
  /** "Xem từ ghế này": a sheet gets out of the way so the screen can be seen. */
  | { type: 'view-from-seat' }
  /** The viewport changed between side-panel and sheet layouts (rotation, resize). */
  | { type: 'layout' };

export interface TaskLayoutResult {
  state: TaskLayout;
  /** The tour and walking belong to Khám phá: leaving it stops them where the camera is. */
  stopExploreActivities: boolean;
}

const panelLayout = (layout: PanelLayout | boolean): PanelLayout => (typeof layout === 'boolean' ? (layout ? 'sheet' : 'side') : layout);

/**
 * Applies `event` for the current `layout` (`true`/`false` are `sheet`/`side`). Sheets start closed
 * and side panels open; on phones (`immersive`) the map is either closed or the full-screen dialog,
 * and Escape or "Xem từ ghế này" closes it outright.
 */
export function reduceTaskLayout(state: TaskLayout, event: TaskLayoutEvent, layout: PanelLayout | boolean): TaskLayoutResult {
  const mode = panelLayout(layout);
  const sheet = mode !== 'side';
  const shown: PanelState = mode === 'immersive' ? 'expanded' : 'open';
  const result = (next: Partial<TaskLayout>, stopExploreActivities = false): TaskLayoutResult => ({
    state: { ...state, ...next },
    stopExploreActivities,
  });
  switch (event.type) {
    case 'task': {
      if (event.task === state.task) return result({});
      // The panel only shows with seat selection; it comes back the way the user left it (never by
      // itself over a phone's whole screen).
      const panel: PanelState = event.task === 'seats' && mode !== 'immersive' && (state.panelChoice ?? !sheet) ? 'open' : 'closed';
      return result({ task: event.task, panel }, state.task === 'explore');
    }
    case 'panel':
      if (event.open) {
        // The map takes the keys: opening it stops the tour and walking, also when walking was
        // started (from the control panel) while the task was still Chọn ghế.
        const left = state.task === 'explore' || state.panel === 'closed';
        return result({ task: 'seats', panel: state.panel === 'expanded' ? 'expanded' : shown, panelChoice: true }, left);
      }
      return result({ panel: 'closed', panelChoice: state.task === 'seats' ? false : state.panelChoice });
    case 'expand':
      if (mode !== 'sheet' || state.task !== 'seats' || state.panel === 'closed') return result({});
      return result({ panel: event.expanded ? 'expanded' : 'open' });
    case 'escape':
      if (state.panel === 'expanded' && mode !== 'immersive') return result({ panel: 'open' });
      if (state.panel !== 'closed') return result({ panel: 'closed', panelChoice: false });
      return result({});
    case 'view-from-seat':
      return sheet && state.panel !== 'closed' ? result({ panel: 'closed', panelChoice: false }) : result({});
    case 'layout':
      if (mode === 'side' && state.panel === 'expanded') return result({ panel: 'open' });
      if (mode === 'immersive' && state.panel === 'open') return result({ panel: 'expanded' });
      return result({});
  }
}

export function initialTaskLayout(task: CinemaTask = 'explore', panelChoice: boolean | null = null, layout: PanelLayout | boolean = false): TaskLayout {
  const mode = panelLayout(layout);
  return { task, panel: task === 'seats' && mode !== 'immersive' && (panelChoice ?? mode === 'side') ? 'open' : 'closed', panelChoice };
}
