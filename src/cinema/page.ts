import { BufferGeometry, Material, Object3D, Texture, WebGLRenderTarget } from 'three';
import type { ToggleablePart } from './architecture.ts';
import { DEFAULT_PRESET, describePreset, formatMetres, presetInfo, type CameraMode, type CameraPresetId } from './cameraPresets.ts';
import { createAuditoriumLayout, type Vec3 } from './layout.ts';
import { loadQuality, saveQuality } from './quality.ts';
import { prefersReducedMotion } from './renderHost.ts';
import { createSeatPanel } from './seatPanel.ts';
import type { SeatSelection } from './selection.ts';
import { createCinemaUi, TOGGLEABLE_PARTS } from './ui.ts';
import { validateLayout } from './validation.ts';
import { CinemaView, WebGLUnavailableError, type TourEndReason } from './view.ts';

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
      /** Constructors whose live instances the lifecycle check counts after garbage collection. */
      types: Record<string, unknown>;
    };
  }
}

/** State that outlives one mount of the page (opening the inspector, hot updates of this module). */
export interface CinemaSession {
  selection: SeatSelection;
  /** null until the user opens or closes the seat panel; then their choice. */
  seatPanelOpen: boolean | null;
}

export interface CinemaPageOptions {
  /** Opens the seat inspector (a separate route; this page is unmounted first). */
  openInspector(): void;
  session: CinemaSession;
}

const FREE_CAMERA_CAPTION = 'Camera tự do: kéo để xoay, cuộn hoặc chụm để thu phóng. Chọn một góc để quay lại.';
const TOUR_CAPTION = 'Tham quan: kéo, cuộn, nhấn phím di chuyển hoặc chọn một góc để dừng tại chỗ.';
const TOUR_STEPS_CAPTION = 'Tham quan từng điểm (giảm chuyển động): dùng Trước / Tiếp, kéo để nhìn quanh.';
const TOUR_ENDED: Record<Exclude<TourEndReason, 'command'>, string> = {
  finished: 'Tham quan kết thúc ở góc tổng quan. Kéo để xoay quanh.',
  input: 'Đã dừng tham quan tại đây. Kéo để nhìn quanh, hoặc chọn một góc.',
  hidden: 'Tham quan đã dừng khi chuyển sang tab khác. Kéo để nhìn quanh, hoặc bấm Tham quan để xem lại.',
  'context-lost': 'Tham quan đã dừng vì mất ngữ cảnh WebGL.',
};

/** Mounts the /cinema page into `host`. Returns a function that tears everything down. */
export function mountCinemaPage(host: HTMLElement, options: CinemaPageOptions): () => void {
  document.title = 'Phòng chiếu 3D';
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
  let view: CinemaView | null = null;
  const { selection } = options.session;
  // The view a seat view returns to: the preset it was opened from, else the overview.
  let returnPreset: CameraPresetId | null = null;
  const touch = window.matchMedia?.('(any-pointer: coarse)').matches ?? false;

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
    if (!view) return;
    const pose = view.setPreset(id, animate);
    ui.setCaption(describePreset(id, layout, pose));
  };

  const leavePreset = () => {
    activePreset = null;
    ui.setActivePreset(null);
  };

  const ui = createCinemaUi(host, layout, {
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
        ui.setCaption('Đã dừng khám phá tại đây. Kéo để nhìn quanh, hoặc chọn một góc.');
        return;
      }
      touring = false;
      leaveSeatView();
      leavePreset();
      setExploring(true);
      ui.setCaption('Đang tới điểm bắt đầu khám phá…');
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
    onSeatPanel: () => panel.setOpen(!panel.open, { returnFocus: ui.seatPanelButton }),
    onReturn: () => applyPreset(returnPreset ?? DEFAULT_PRESET, true),
  });

  const viewFromSeat = (id: string) => {
    const seat = selection.seat(id);
    if (!view || !seat) return;
    // Seat to seat keeps the original way back.
    returnPreset ??= activePreset ?? DEFAULT_PRESET;
    touring = false;
    setExploring(false);
    leavePreset();
    view.viewFromSeat(id);
    ui.setCaption(
      `Ghế ${seat.id}: hàng ${seat.rowLabel}, ghế số ${seat.seatNumber}, mắt cao ${formatMetres(layout.config.viewer.eyeHeight)} trên sàn hàng. Kéo để nhìn quanh.`,
    );
    ui.setReturn(`Trở về ${presetInfo(returnPreset).label.toLowerCase()}`);
  };

  const panel = createSeatPanel(ui.main, ui.root, layout, selection, {
    onViewFromSeat: viewFromSeat,
    onOpenChange: (open) => {
      ui.setSeatPanelOpen(open);
      options.session.seatPanelOpen = open;
    },
  });
  // Open by default on wide screens; on phones it would take half the screen, so it waits for the button.
  const panelOpen = options.session.seatPanelOpen ?? (window.matchMedia?.('(min-width: 1100px)').matches ?? false);
  panel.setOpen(panelOpen, { returnFocus: ui.seatPanelButton });
  ui.setSeatPanelOpen(panelOpen);

  // The user's stored choice, else a conservative default from device capabilities.
  const quality = loadQuality();
  ui.setQuality(quality.level);

  // Reduced motion can change while the page is open (system setting); follow it.
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotionChange = () => view?.setReducedMotion(motionQuery?.matches ?? false);
  motionQuery?.addEventListener('change', onMotionChange);

  try {
    view = new CinemaView(
      ui.viewport,
      layout,
      {
        onStatus: (status) => ui.setStatus(status),
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
        },
        onExploreStart: (relocatedTo) => {
          const how = touch
            ? 'kéo cần điều khiển ở góc dưới để đi, kéo phần còn lại để nhìn quanh.'
            : 'W A S D hoặc phím mũi tên để đi, kéo để nhìn quanh.';
          ui.setCaption(`${relocatedTo ? `Đã đưa bạn tới ${relocatedTo.label}. ` : ''}Khám phá: ${how} Bấm Khám phá lần nữa để dừng.`);
        },
        onSeatTap: (id) => {
          // Same rules as the map: the seat becomes the active one, and its selection toggles.
          selection.setActive(id);
          const result = selection.toggle(id);
          const max = selection.maxSelected;
          ui.setNotice(
            result.ok
              ? `${result.selected ? 'Đã chọn' : 'Đã bỏ chọn'} ${id} · ${selection.selectedCount}/${max} ghế`
              : result.reason === 'reserved'
                ? `${id} đã được đặt — không chọn được`
                : `Đã đủ ${max} ghế — bỏ bớt để chọn ${id}`,
          );
        },
      },
      { quality: quality.level, reducedMotion: prefersReducedMotion(), touchStick: touch, selection },
    );
    applyPreset(DEFAULT_PRESET, false);
  } catch (error) {
    console.error('[cinema] Could not start the 3D view:', error);
    const message =
      error instanceof WebGLUnavailableError ? error.message : 'Đã xảy ra lỗi khi dựng cảnh. Xem chi tiết trong console.';
    ui.setStatus({ kind: 'error', message });
    // Seat selection does not need the renderer: the map stays usable, only the seat views are gone.
    ui.seatPanelButton.disabled = false;
    panel.setOpen(true, { returnFocus: ui.seatPanelButton });
    panel.setViewAvailable(false, 'Không xem được góc nhìn từ ghế: cảnh 3D không khả dụng trên trình duyệt này. Sơ đồ vẫn dùng được.');
  }

  if (import.meta.env.DEV) {
    window.__cinema = {
      layout,
      getState: () => ({
        preset: activePreset,
        touring,
        exploring,
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
      types: { BufferGeometry, Material, Texture, Object3D, WebGLRenderTarget },
    };
  }

  return () => {
    motionQuery?.removeEventListener('change', onMotionChange);
    view?.dispose();
    view = null;
    panel.dispose();
    ui.dispose();
    if (import.meta.env.DEV) delete window.__cinema;
  };
}
