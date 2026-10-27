import type { ToggleablePart } from './architecture.ts';
import { DEFAULT_PRESET, describePreset, presetInfo, type CameraMode, type CameraPresetId } from './cameraPresets.ts';
import { createAuditoriumLayout, type Vec3 } from './layout.ts';
import { loadQuality, saveQuality } from './quality.ts';
import { prefersReducedMotion } from './renderHost.ts';
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
    };
  }
}

export interface CinemaPageOptions {
  /** Opens the seat inspector (a separate route; this page is unmounted first). */
  openInspector(): void;
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

  const applyPreset = (id: CameraPresetId, animate: boolean) => {
    touring = false;
    setExploring(false);
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
  });

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
      },
      { quality: quality.level, reducedMotion: prefersReducedMotion(), touchStick: touch },
    );
    applyPreset(DEFAULT_PRESET, false);
  } catch (error) {
    console.error('[cinema] Could not start the 3D view:', error);
    const message =
      error instanceof WebGLUnavailableError ? error.message : 'Đã xảy ra lỗi khi dựng cảnh. Xem chi tiết trong console.';
    ui.setStatus({ kind: 'error', message });
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
    };
  }

  return () => {
    motionQuery?.removeEventListener('change', onMotionChange);
    view?.dispose();
    view = null;
    ui.dispose();
    if (import.meta.env.DEV) delete window.__cinema;
  };
}
