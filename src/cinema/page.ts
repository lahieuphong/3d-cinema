import '../styles.css';
import { PAGE_TITLES } from '../brand.ts';
import type { ToggleablePart } from './architecture.ts';
import { DEFAULT_PRESET, describePreset, formatMetres, presetInfo, type CameraMode, type CameraPresetId } from './cameraPresets.ts';
import { createAuditoriumLayout, type Vec3 } from './layout.ts';
import { DEMO_FILM, devFilm } from './media.ts';
import { MediaController, type MediaControllerOptions } from './mediaController.ts';
import { createPlayerUi } from './playerUi.ts';
import { loadQuality, prefersReducedMotion, saveQuality } from './quality.ts';
import { createSeatPanel } from './seatPanel.ts';
import { createSeatSummary } from './seatSummary.ts';
import { DEMO_RESERVED_SEAT_IDS, SeatSelection } from './selection.ts';
import {
  IMMERSIVE_LAYOUT_QUERY,
  initialTaskLayout,
  reduceTaskLayout,
  SHEET_LAYOUT_QUERY,
  type CinemaTask,
  type PanelLayout,
  type TaskLayout,
  type TaskLayoutEvent,
} from './taskLayout.ts';
import { createCinemaUi, TOGGLEABLE_PARTS } from './ui.ts';
import { validateLayout } from './validation.ts';
import type { CinemaView, CinemaViewCallbacks, TourEndReason } from './view.ts';

/** The 3D part of the page (three.js, the room, the renderer): a separate download. */
type SceneModule = typeof import('./view.ts');

declare global {
  interface Window {
    /** Development-only inspection hook used by `npm run capture`. */
    __cinema?: {
      layout: ReturnType<typeof createAuditoriumLayout>;
      getState(): unknown;
      setCamera(position: Vec3, target: Vec3, mode?: CameraMode): void;
      tourFrame(t: number): unknown;
      showPaths(on: boolean): void;
      measureCost(): unknown;
      measureFrames(frames?: number): Promise<unknown>;
      measureTour(frames?: number): Promise<unknown>;
      seatScreenPoint(seatId: string): { x: number; y: number; visible: boolean } | null;
      seatLook(seatId: string): unknown;
      measurePicking(samples?: number): unknown;
      /** The film: media snapshot, playback quality, frame clock and screen. */
      film(): unknown;
      /** Canvas pixels of points of the picture next to the same points of the video frame. */
      screenPixels(points: Array<[number, number]>, area?: 'picture' | 'screen'): unknown;
      /** The film's element, to check it is the same one across camera, seat and quality changes. */
      filmElement(): HTMLVideoElement;
      /** Constructors whose live instances the lifecycle check counts after garbage collection. */
      readonly types: Record<string, unknown>;
    };
  }
}

/** State that outlives one mount of the page (opening the inspector, hot updates of this module). */
export interface CinemaSession {
  selection: SeatSelection;
  /** null until the user opens or closes the seat panel; then their choice. */
  seatPanelOpen: boolean | null;
  /** Where the film was and how it sounded when the page was last left (it always comes back paused). */
  media: MediaControllerOptions['resume'] | null;
  /** The task shown when the page was left (null: start in Khám phá). */
  task: CinemaTask | null;
}

export interface CinemaPageOptions {
  /** Opens the seat inspector (a separate route; this page is unmounted first). */
  openInspector(): void;
  /** In-app way back to the landing page (the header's brand link); without it the link loads `/`. */
  goHome?(): void;
  session: CinemaSession;
}

/** A visit's state, created with the auditorium's first mount and kept while the tab stays on the site. */
export function createCinemaSession(): CinemaSession {
  const { seats, config } = createAuditoriumLayout();
  return { selection: new SeatSelection(seats, DEMO_RESERVED_SEAT_IDS, config.selection.maxSeats), seatPanelOpen: null, media: null, task: null };
}

const FREE_CAMERA_CAPTION = 'Camera tự do: kéo để xoay, cuộn hoặc chụm để thu phóng. Chọn một góc để quay lại.';
const TOUR_CAPTION = 'Tham quan: kéo, cuộn, nhấn phím di chuyển hoặc chọn một góc để dừng tại chỗ.';
const TOUR_STEPS_CAPTION = 'Tham quan từng điểm (giảm chuyển động): dùng Trước / Tiếp, kéo để nhìn quanh.';
const TOUR_ENDED: Record<Exclude<TourEndReason, 'command'>, string> = {
  finished: 'Tham quan kết thúc ở góc tổng quan. Kéo để xoay quanh.',
  input: 'Đã dừng tham quan tại đây. Kéo để nhìn quanh, hoặc chọn một góc.',
  hidden: 'Tham quan đã dừng khi chuyển sang tab khác. Kéo để nhìn quanh, hoặc bấm Tham quan để xem lại.',
  'context-lost': 'Tham quan đã dừng vì mất ngữ cảnh WebGL.',
  task: 'Đã dừng tham quan tại đây khi chuyển tác vụ.',
};
const NO_SCENE_CONTROLS =
  'Không có cảnh 3D trên trình duyệt này nên không dùng được góc nhìn, tham quan và đi bộ. Sơ đồ ghế và phim (dạng 2D) vẫn dùng được.';
const NO_SCENE_SEAT_VIEW = 'Không xem được góc nhìn từ ghế: cảnh 3D không khả dụng trên trình duyệt này. Sơ đồ vẫn dùng được.';
/** How long a lost WebGL context may take to come back before "Dựng lại cảnh 3D" is offered. */
const CONTEXT_WAIT_MS = 5000;

/**
 * Mounts the /cinema page into `host`. Returns a function that tears everything down.
 *
 * The page's own controls (tasks, seat map, player) are built first and work at once; the 3D part
 * downloads in parallel and the room is built once it arrives. Without it (no WebGL, a failed
 * download, a broken build) the map and the film (shown flat, in 2D) stay usable, and a failure
 * that may pass offers "Thử lại", which rebuilds only the scene: the seat selection, the film's
 * element and place, and the quality choice are untouched.
 */
export function mountCinemaPage(host: HTMLElement, options: CinemaPageOptions): () => void {
  document.title = PAGE_TITLES.cinema;
  let sceneModule: Promise<SceneModule> = import('./view.ts');
  const layout = createAuditoriumLayout();
  if (import.meta.env.DEV) {
    const problems = validateLayout(layout);
    if (problems.length > 0) console.warn('[cinema] Layout problems:', problems);
  }

  const visibility = Object.fromEntries(TOGGLEABLE_PARTS.map(({ part }) => [part, true])) as Record<ToggleablePart, boolean>;
  // Parts hidden by an inspection preset (not by the user). They come back once the camera has
  // arrived somewhere else, so it never flies through a wall that reappears on the way.
  const autoHidden = new Set<ToggleablePart>();
  let activePreset: CameraPresetId | null = DEFAULT_PRESET;
  let touring = false;
  let exploring = false;
  let scene: SceneModule | null = null;
  let view: CinemaView | null = null;
  let sceneFailed = false;
  let disposed = false;
  let contextTimer: ReturnType<typeof setTimeout> | undefined;
  const { selection } = options.session;
  // The view a seat view returns to: the preset it was opened from, else the overview.
  let returnPreset: CameraPresetId | null = null;
  // The seat whose eye the camera is at, or null.
  let viewingSeat: string | null = null;
  const touch = window.matchMedia?.('(any-pointer: coarse)').matches ?? false;
  const sheetQuery = window.matchMedia?.(SHEET_LAYOUT_QUERY);
  const isSheet = () => sheetQuery?.matches ?? false;
  // Phones: the room fills the screen and the controls live in the floating control hub.
  const immersiveQuery = window.matchMedia?.(IMMERSIVE_LAYOUT_QUERY);
  const isImmersive = () => immersiveQuery?.matches ?? false;
  const panelLayout = (): PanelLayout => (isImmersive() ? 'immersive' : isSheet() ? 'sheet' : 'side');
  let tasks: TaskLayout = initialTaskLayout(options.session.task ?? 'explore', options.session.seatPanelOpen, panelLayout());

  // The film: one controller (one element, one audio stream) for the life of this mount. Leaving
  // the page records where it was; the next mount starts paused there, with the same sound.
  const film = (import.meta.env.DEV ? devFilm(location.search) : null) ?? DEMO_FILM;
  // The film's metadata and poster wait for the 3D part (they would share the connection with it).
  const media = new MediaController(film, { resume: options.session.media ?? undefined, loadNow: false });
  let poster: HTMLImageElement | null = null;
  const player = createPlayerUi(film, {
    onPlay: () => void media.play(),
    onPause: () => media.pause(),
    onReplay: () => void media.replay(),
    onSeek: (seconds) => media.seek(seconds),
    onToggleMute: () => media.setMuted(!media.video.muted),
    onVolume: (volume) => media.setVolume(volume),
    onRetry: () => media.retry(),
  });
  const unsubscribePlayer = media.subscribe((snapshot, change) => {
    player.update(snapshot, change);
    if (change === 'state') ui.setPlaying(snapshot.state === 'playing');
  });
  player.update(media.snapshot, 'all');
  // A hidden tab pauses the film; coming back does not resume it.
  const onVisibility = () => {
    if (document.hidden) media.suspend('hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);

  const setPartVisible = (part: ToggleablePart, visible: boolean) => {
    visibility[part] = visible;
    view?.setPartVisible(part, visible);
    ui.setPartVisible(part, visible);
  };

  const restoreAutoHidden = () => {
    const keep = activePreset ? presetInfo(activePreset).hides : [];
    for (const part of [...autoHidden]) {
      if (keep.includes(part)) continue;
      autoHidden.delete(part);
      setPartVisible(part, true);
    }
  };

  const setExploring = (active: boolean) => {
    exploring = active;
    ui.setExploring(active);
  };

  const leaveSeatView = () => {
    returnPreset = null;
    viewingSeat = null;
    ui.setReturn(null);
  };

  const applyPreset = (id: CameraPresetId, animate: boolean) => {
    touring = false;
    setExploring(false);
    leaveSeatView();
    for (const part of presetInfo(id).hides) {
      if (!visibility[part]) continue;
      setPartVisible(part, false);
      autoHidden.add(part);
    }
    activePreset = id;
    ui.setActivePreset(id);
    updateWatchView();
    if (!view) return;
    const pose = view.setPreset(id, animate);
    ui.setCaption(describePreset(id, layout, pose));
  };

  const leavePreset = () => {
    activePreset = null;
    ui.setActivePreset(null);
  };

  /** Leaving Khám phá ends the tour and walking where the camera is (it does not move). */
  const stopExploreActivities = () => {
    if (!view) return;
    if (touring) view.stopTour('task');
    if (exploring) {
      view.stopExplore();
      setExploring(false);
      ui.setCaption('Đã dừng đi bộ tại đây khi chuyển tác vụ.');
    }
    updateWatchView();
  };

  const ui = createCinemaUi(host, {
    onTask: (task) => dispatch({ type: 'task', task }),
    onPreset: (id) => applyPreset(id, true),
    onReset: () => {
      autoHidden.clear();
      for (const { part } of TOGGLEABLE_PARTS) setPartVisible(part, true);
      applyPreset(DEFAULT_PRESET, true);
    },
    onTour: () => {
      if (!view) return;
      if (touring) {
        view.stopTour('input');
        return;
      }
      setExploring(false);
      leaveSeatView();
      leavePreset();
      touring = true;
      view.startTour();
    },
    onTourStep: (delta) => view?.tourStep(delta),
    onExplore: () => {
      if (!view) return;
      if (exploring) {
        view.stopExplore();
        setExploring(false);
        ui.setCaption('Đã dừng đi bộ tại đây. Kéo để nhìn quanh, hoặc chọn một góc.');
        return;
      }
      touring = false;
      leaveSeatView();
      leavePreset();
      setExploring(true);
      ui.setCaption('Đang tới điểm bắt đầu đi bộ…');
      view.startExplore();
    },
    onToggle: (part, visible) => {
      autoHidden.delete(part);
      setPartVisible(part, visible);
    },
    onQuality: (level) => {
      view?.setQuality(level);
      saveQuality(level);
      ui.setQuality(level);
    },
    onOpenInspector: () => options.openInspector(),
    onReturn: () => applyPreset(returnPreset ?? DEFAULT_PRESET, true),
    onWatchAction: () => {
      const active = selection.active;
      if (active && active !== viewingSeat && view) viewFromSeat(active);
      else dispatch({ type: 'task', task: 'seats' });
    },
    onRetryScene: () => retryScene(),
    onHome: options.goHome,
    onSeatCardView: (id) => {
      dispatch({ type: 'view-from-seat' });
      viewFromSeat(id);
    },
  }, { touch });
  ui.setLayout(isImmersive());

  const viewFromSeat = (id: string) => {
    const seat = selection.seat(id);
    if (!view || !seat) return;
    // Seat to seat keeps the original way back.
    returnPreset ??= activePreset ?? DEFAULT_PRESET;
    touring = false;
    setExploring(false);
    leavePreset();
    viewingSeat = id;
    view.viewFromSeat(id);
    ui.setCaption(
      `Ghế ${seat.id}: hàng ${seat.rowLabel}, ghế số ${seat.seatNumber}, mắt cao ${formatMetres(layout.config.viewer.eyeHeight)} trên sàn hàng. Kéo để nhìn quanh.`,
    );
    ui.setReturn(`Trở về ${presetInfo(returnPreset).label.toLowerCase()}`);
    updateWatchView();
  };

  // Xem phim says where the camera is, and offers the one camera move that fits.
  const updateWatchView = () => {
    const active = selection.active;
    if (!view) {
      ui.setWatchView(sceneFailed ? 'Không có cảnh 3D: phim phát dạng 2D.' : 'Phòng chiếu 3D đang được dựng…', null);
      summary.setViewing(null);
      return;
    }
    summary.setViewing(viewingSeat);
    const where = viewingSeat ? `Đang xem từ ghế ${viewingSeat}` : activePreset ? `Góc nhìn: ${presetInfo(activePreset).label}` : 'Góc nhìn: tự do';
    const action = active && active !== viewingSeat ? `Xem từ ghế ${active}` : viewingSeat ? 'Đổi ghế' : 'Chọn ghế';
    ui.setWatchView(where, action);
  };

  const summary = createSeatSummary(ui.dock.seats, selection, {
    onTogglePanel: () => dispatch({ type: 'panel', open: tasks.panel === 'closed' }),
    onViewFromSeat: (id) => {
      dispatch({ type: 'view-from-seat' });
      viewFromSeat(id);
    },
  });
  const panel = createSeatPanel(ui.main, ui.root, layout, selection, {
    onViewFromSeat: (id) => {
      dispatch({ type: 'view-from-seat' });
      viewFromSeat(id);
    },
    onClose: () => dispatch({ type: 'panel', open: false }),
    onExpand: (expanded) => dispatch({ type: 'expand', expanded }),
    onEscape: () => dispatch({ type: 'escape' }),
  });
  ui.dock.watch.append(player.root);
  player.root.append(ui.watchView);
  ui.attachMini(player.mini);
  ui.attachFilmStatus(player.status);
  ui.root.append(player.live);

  const focusable = (element: Element) =>
    element instanceof HTMLElement && element.isConnected && element.getClientRects().length > 0 && !element.closest('[inert]');

  /** Applies a task or panel change; focus that was in something now hidden goes to the control that leads back to it. */
  function dispatch(event: TaskLayoutEvent): void {
    const previous = tasks;
    const result = reduceTaskLayout(tasks, event, panelLayout());
    tasks = result.state;
    options.session.task = tasks.task;
    options.session.seatPanelOpen = tasks.panelChoice;
    if (result.stopExploreActivities) stopExploreActivities();
    const focused = document.activeElement;
    renderLayout();
    if (focused && focused !== document.body && !focusable(focused)) {
      const target = previous.panel === 'expanded' && tasks.panel === 'open' ? panel.expandButton : tasks.task === 'seats' ? summary.toggle : ui.taskButton(tasks.task);
      // On a phone the task switch is in the round button's panel: that button leads back to everything.
      const fallback = isImmersive() ? ui.hubToggle : ui.taskButton(tasks.task);
      (focusable(target) ? target : fallback).focus();
    }
  }

  function renderLayout(): void {
    ui.setTask(tasks.task);
    ui.setPanel(tasks.panel);
    panel.setState(tasks.panel);
    summary.setPanelOpen(tasks.panel !== 'closed');
    updateWatchView();
  }
  const onSheetChange = () => dispatch({ type: 'layout' });
  sheetQuery?.addEventListener('change', onSheetChange);
  const onImmersiveChange = () => {
    ui.setLayout(isImmersive());
    dispatch({ type: 'layout' });
  };
  immersiveQuery?.addEventListener('change', onImmersiveChange);
  renderLayout();

  const unsubscribeSelection = selection.subscribe((change) => {
    if (change.selection) ui.setSeatCount(selection.selectedCount);
    if (change.active || change.selection) updateWatchView();
  });
  ui.setSeatCount(selection.selectedCount);

  // The user's stored choice, else a conservative default from device capabilities.
  const quality = loadQuality();
  ui.setQuality(quality.level);

  // Reduced motion can change while the page is open (system setting); follow it.
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotionChange = () => view?.setReducedMotion(motionQuery?.matches ?? false);
  motionQuery?.addEventListener('change', onMotionChange);

  const callbacks: CinemaViewCallbacks = {
    onStatus: (status) => {
      ui.setStatus(status);
      clearTimeout(contextTimer);
      // No context, no screen: the film pauses and waits for the user once the room is back.
      if (status.kind === 'context-lost') {
        media.suspend('context-lost');
        player.setUnavailable('Cảnh 3D đang được khôi phục; chưa phát được.');
        contextTimer = setTimeout(() => ui.setStatus({ kind: 'context-lost', stuck: true }), CONTEXT_WAIT_MS);
      } else {
        player.setUnavailable(null);
        ui.setSceneControls(true);
        media.load();
        // Phones, first visit: once the room is there, how to look around and where the controls are.
        if (status.kind === 'ready') ui.offerHubHint();
      }
    },
    onCameraState: (state) => {
      ui.setCameraState(state);
      ui.setTransitioning(state === 'transition');
    },
    onArrive: restoreAutoHidden,
    onManualCamera: () => {
      // Looking around from a seat keeps its caption; an orbit no longer matches the preset.
      if (activePreset && presetInfo(activePreset).space === 'experience' && activePreset !== 'seatEye') {
        ui.setCaption(FREE_CAMERA_CAPTION);
      }
    },
    onTour: (status, ended) => {
      ui.setTour(status);
      if (status) {
        if (!touring) return;
        ui.setCaption(status.steps ? TOUR_STEPS_CAPTION : TOUR_CAPTION);
        return;
      }
      touring = false;
      if (ended === 'finished') {
        activePreset = 'overview';
        ui.setActivePreset('overview');
      }
      if (ended && ended !== 'command') ui.setCaption(TOUR_ENDED[ended]);
      updateWatchView();
    },
    onExploreStart: (relocatedTo) => {
      const how = touch
        ? 'kéo cần điều khiển ở góc dưới để đi, kéo phần còn lại để nhìn quanh.'
        : 'W A S D hoặc phím mũi tên để đi, kéo để nhìn quanh.';
      const stop = isImmersive() ? 'Để dừng: Đi bộ trong nút điều khiển.' : 'Bấm Đi bộ lần nữa để dừng.';
      ui.setCaption(`${relocatedTo ? `Đã đưa bạn tới ${relocatedTo.label}. ` : ''}Đi bộ: ${how} ${stop}`);
    },
    onSeatTap: (id) => {
      // Same rules as the map: the seat becomes the active one, and its selection toggles.
      selection.setActive(id);
      const result = selection.toggle(id);
      const max = selection.maxSelected;
      const text = result.ok
        ? `${result.selected ? 'Đã chọn' : 'Đã bỏ chọn'} ${id} · ${selection.selectedCount}/${max} ghế`
        : result.reason === 'reserved'
          ? `${id} đã được đặt — không chọn được`
          : `Đã đủ ${max} ghế — bỏ bớt để chọn ${id}`;
      ui.setNotice(text);
      // Phones: the same words on a card that also offers the view from that seat.
      ui.showSeatCard(id, text, view !== null && id !== viewingSeat);
    },
  };

  /** No scene (no WebGL, a failed download or build): the map and the flat film carry on. */
  const failScene = (message: string, retry: boolean) => {
    const first = !sceneFailed;
    sceneFailed = true;
    ui.setStatus({ kind: 'error', message, retry });
    ui.setSceneControls(false, NO_SCENE_CONTROLS);
    panel.setViewAvailable(false, NO_SCENE_SEAT_VIEW);
    summary.setViewAvailable(false);
    player.setUnavailable(null);
    media.load();
    // The same film, element and controls, shown flat in place of the room (never both).
    ui.showVideo2d(media.video, `Đang xem video ở chế độ 2D (không có cảnh 3D): ${film.title}`);
    updateWatchView();
    // Seat selection does not need the renderer: with nothing to explore, it is where the page starts.
    // On a phone the map would cover the message and the film; it stays one press away in the hub.
    if (first && tasks.task === 'explore') dispatch(isImmersive() ? { type: 'task', task: 'seats' } : { type: 'panel', open: true });
  };

  const createView = (module: SceneModule) => {
    poster ??= film.poster ? loadImage(film.poster) : null;
    try {
      view = new module.CinemaView(ui.viewport, layout, callbacks, {
        quality: quality.level,
        reducedMotion: prefersReducedMotion(),
        touchStick: touch,
        selection,
        media: { controller: media, poster },
      });
    } catch (error) {
      view = null;
      console.error('[cinema] Could not start the 3D view:', error);
      const unavailable = error instanceof module.WebGLUnavailableError;
      failScene(unavailable ? error.message : 'Đã xảy ra lỗi khi dựng cảnh. Xem chi tiết trong console.', !unavailable);
      return;
    }
    if (sceneFailed) {
      // Back after a failure: the room takes the flat film's place.
      sceneFailed = false;
      ui.hideVideo2d();
      panel.setViewAvailable(true);
      summary.setViewAvailable(true);
    }
    for (const { part } of TOGGLEABLE_PARTS) if (!visibility[part]) view.setPartVisible(part, false);
    ui.setQuality(quality.level);
    const seat = viewingSeat;
    if (seat) {
      // A rebuilt scene comes back to the same seat.
      returnPreset ??= DEFAULT_PRESET;
      viewingSeat = null;
      viewFromSeat(seat);
    } else {
      applyPreset(activePreset ?? DEFAULT_PRESET, false);
    }
  };

  const startScene = async () => {
    ui.setSceneControls(false);
    player.setUnavailable('Phòng chiếu 3D đang được dựng; phim phát được khi cảnh sẵn sàng.');
    if (!scene) {
      ui.setStatus({ kind: 'loading', step: 'code' });
      try {
        scene = await sceneModule;
      } catch (error) {
        if (disposed) return;
        console.error('[cinema] Could not load the 3D part of the page:', error);
        failScene('Không tải được phần 3D của trang (mạng có thể đã bị gián đoạn).', true);
        return;
      }
      if (disposed) return;
    }
    ui.setStatus({ kind: 'loading', step: 'scene' });
    // Let "Đang dựng…" reach the screen before the room is built (a moment of busy main thread).
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      setTimeout(resolve, 100);
    });
    if (disposed || view) return;
    createView(scene);
  };

  /** "Thử lại" / "Dựng lại cảnh 3D": the scene only; selection, film and quality stay as they are. */
  const retryScene = () => {
    clearTimeout(contextTimer);
    view?.dispose();
    view = null;
    if (!scene) sceneModule = import('./view.ts');
    void startScene();
  };

  void startScene();

  if (import.meta.env.DEV) {
    window.__cinema = {
      layout,
      getState: () => ({
        preset: activePreset,
        touring,
        exploring,
        task: tasks.task,
        panel: tasks.panel,
        qualitySource: quality.source,
        visibility: { ...visibility },
        seats: {
          selected: selection.selectedIds,
          active: selection.active,
          hovered: selection.hovered,
          reserved: selection.reservedIds.length,
          listeners: selection.listenerCount,
          panelOpen: panel.open,
        },
        canvasCount: document.querySelectorAll('canvas').length,
        view: view?.getDebugState() ?? null,
      }),
      setCamera: (position, target, mode = 'orbit') => {
        if (!view) return;
        touring = false;
        setExploring(false);
        leaveSeatView();
        leavePreset();
        view.debugSetCamera(position, target, mode);
        ui.setCaption(FREE_CAMERA_CAPTION);
      },
      tourFrame: (t) => {
        touring = false;
        setExploring(false);
        leavePreset();
        return view?.debugTourFrame(t) ?? null;
      },
      showPaths: (on) => view?.debugShowPaths(on),
      measureCost: () => view?.measureCost() ?? null,
      measureFrames: async (frames) => (view ? view.measureFrames(frames) : null),
      measureTour: async (frames) => (view ? view.measureTour(frames) : null),
      seatScreenPoint: (id) => view?.debugSeatScreenPoint(id) ?? null,
      seatLook: (id) => view?.debugSeatLook(id) ?? null,
      measurePicking: (samples) => view?.measurePicking(samples) ?? null,
      film: () => {
        const quality = media.video.getVideoPlaybackQuality?.();
        return {
          id: film.id,
          snapshot: media.snapshot,
          readyState: media.video.readyState,
          networkState: media.video.networkState,
          paused: media.video.paused,
          inDocument: media.video.isConnected,
          subscribers: media.listenerCount,
          playback: quality ? { decoded: quality.totalVideoFrames, dropped: quality.droppedVideoFrames } : null,
          audioDecodedBytes: (media.video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? null,
          view: view?.getDebugState().film ?? null,
          player: { state: player.root.dataset.state, notice: player.root.dataset.notice },
        };
      },
      screenPixels: (points, area) => view?.debugScreenPixels(points, area) ?? null,
      filmElement: () => media.video,
      get types() {
        return { ...(scene?.DEBUG_TYPES ?? {}), MediaController, HTMLVideoElement };
      },
    };
  }

  return () => {
    disposed = true;
    clearTimeout(contextTimer);
    motionQuery?.removeEventListener('change', onMotionChange);
    sheetQuery?.removeEventListener('change', onSheetChange);
    immersiveQuery?.removeEventListener('change', onImmersiveChange);
    document.removeEventListener('visibilitychange', onVisibility);
    // Remember the film's place and sound, then stop it before anything else goes.
    const { currentTime, muted, volume, started } = media.snapshot;
    options.session.media = { time: currentTime, muted, volume, started };
    media.pause();
    view?.dispose();
    view = null;
    unsubscribeSelection();
    unsubscribePlayer();
    player.dispose();
    media.dispose();
    summary.dispose();
    panel.dispose();
    ui.dispose();
    if (import.meta.env.DEV) delete window.__cinema;
  };
}

/** Starts loading an image (the poster) without waiting for it. */
function loadImage(url: string): HTMLImageElement {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  return image;
}
