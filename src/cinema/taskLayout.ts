/**
 * The page's three tasks and where the seat panel is, as one small state machine. It only decides
 * what is shown; the page applies the result. Tasks are presentations of one page: they share the
 * scene, renderer, camera, seat selection, film element and quality, and switching never touches
 * any of them (no new canvas or listeners, no camera move, no playback change).
 */
export type CinemaTask = 'explore' | 'seats' | 'watch';

/** Screens where the seat panel is a sheet under the view rather than a side panel (same as the CSS). */
export const SHEET_LAYOUT_QUERY = '(orientation: portrait) and (max-width: 1024px)';

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

/**
 * Applies `event`. `sheet` is true while the panel is laid out as a sheet (portrait phones and
 * tablets), where it starts closed; side panels start open.
 */
export function reduceTaskLayout(state: TaskLayout, event: TaskLayoutEvent, sheet: boolean): TaskLayoutResult {
  const result = (next: Partial<TaskLayout>, stopExploreActivities = false): TaskLayoutResult => ({
    state: { ...state, ...next },
    stopExploreActivities,
  });
  switch (event.type) {
    case 'task': {
      if (event.task === state.task) return result({});
      // The panel only shows with seat selection; it comes back the way the user left it.
      const panel: PanelState = event.task === 'seats' && (state.panelChoice ?? !sheet) ? 'open' : 'closed';
      return result({ task: event.task, panel }, state.task === 'explore');
    }
    case 'panel':
      if (event.open) {
        const left = state.task === 'explore';
        return result({ task: 'seats', panel: state.panel === 'expanded' ? 'expanded' : 'open', panelChoice: true }, left);
      }
      return result({ panel: 'closed', panelChoice: state.task === 'seats' ? false : state.panelChoice });
    case 'expand':
      if (!sheet || state.task !== 'seats' || state.panel === 'closed') return result({});
      return result({ panel: event.expanded ? 'expanded' : 'open' });
    case 'escape':
      if (state.panel === 'expanded') return result({ panel: 'open' });
      if (state.panel === 'open') return result({ panel: 'closed', panelChoice: false });
      return result({});
    case 'view-from-seat':
      return sheet && state.panel !== 'closed' ? result({ panel: 'closed', panelChoice: false }) : result({});
    case 'layout':
      return !sheet && state.panel === 'expanded' ? result({ panel: 'open' }) : result({});
  }
}

export function initialTaskLayout(task: CinemaTask = 'explore', panelChoice: boolean | null = null, sheet = false): TaskLayout {
  return { task, panel: task === 'seats' && (panelChoice ?? !sheet) ? 'open' : 'closed', panelChoice };
}
