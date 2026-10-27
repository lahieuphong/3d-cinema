import type { ToggleablePart } from './architecture.ts';
import { CAMERA_PRESETS, DEFAULT_PRESET, describePreset, type CameraMode, type CameraPresetId } from './cameraPresets.ts';
import { createAuditoriumLayout, type Vec3 } from './layout.ts';
import { createCinemaUi, TOGGLEABLE_PARTS } from './ui.ts';
import { validateLayout } from './validation.ts';
import { CinemaView, WebGLUnavailableError } from './view.ts';

declare global {
  interface Window {
    /** Development-only inspection hook used by `npm run capture`. */
    __cinema?: {
      layout: ReturnType<typeof createAuditoriumLayout>;
      getState(): unknown;
      setCamera(position: Vec3, target: Vec3, mode?: CameraMode): void;
      measureCost(): unknown;
    };
  }
}

const FREE_CAMERA_CAPTION =
  'Camera tự do: kéo để xoay, cuộn hoặc chụm để thu phóng, chuột phải hoặc hai ngón để dịch. Chọn một góc để quay lại.';

/** Mounts the /cinema page into `host`. Returns a function that tears everything down. */
export function mountCinemaPage(host: HTMLElement): () => void {
  document.title = 'Phòng chiếu 3D';
  const layout = createAuditoriumLayout();
  if (import.meta.env.DEV) {
    const problems = validateLayout(layout);
    if (problems.length > 0) console.warn('[cinema] Layout problems:', problems);
  }

  const visibility = Object.fromEntries(TOGGLEABLE_PARTS.map(({ part }) => [part, true])) as Record<ToggleablePart, boolean>;
  // Parts hidden by the active preset (not by the user); they come back when the preset changes.
  const autoHidden = new Set<ToggleablePart>();
  let activePreset: CameraPresetId = DEFAULT_PRESET;
  let activeMode: CameraMode = 'orbit';
  let view: CinemaView | null = null;

  const setPartVisible = (part: ToggleablePart, visible: boolean) => {
    visibility[part] = visible;
    view?.setPartVisible(part, visible);
    ui.setPartVisible(part, visible);
  };

  const applyPreset = (id: CameraPresetId, animate: boolean) => {
    for (const part of autoHidden) setPartVisible(part, true);
    autoHidden.clear();
    const preset = CAMERA_PRESETS.find((p) => p.id === id)!;
    for (const part of preset.hides) {
      if (!visibility[part]) continue;
      setPartVisible(part, false);
      autoHidden.add(part);
    }
    activePreset = id;
    ui.setActivePreset(id);
    if (!view) return;
    const pose = view.setPreset(id, animate);
    activeMode = pose.mode;
    ui.setCaption(describePreset(id, layout, pose));
  };

  const ui = createCinemaUi(host, layout, {
    onPreset: (id) => applyPreset(id, true),
    onReset: () => {
      autoHidden.clear();
      for (const { part } of TOGGLEABLE_PARTS) setPartVisible(part, true);
      applyPreset(DEFAULT_PRESET, true);
    },
    onToggle: (part, visible) => {
      autoHidden.delete(part);
      setPartVisible(part, visible);
    },
  });

  try {
    view = new CinemaView(ui.viewport, layout, {
      onStatus: (status) => ui.setStatus(status),
      onTransitionChange: (active) => ui.setTransitioning(active),
      onManualCamera: () => {
        // Looking around from a seat keeps the seat caption; a free orbit no longer matches the preset.
        if (activeMode === 'orbit') ui.setCaption(FREE_CAMERA_CAPTION);
      },
    });
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
        visibility: { ...visibility },
        canvasCount: document.querySelectorAll('canvas').length,
        view: view?.getDebugState() ?? null,
      }),
      setCamera: (position, target, mode = 'orbit') => {
        if (!view) return;
        view.debugSetCamera(position, target, mode);
        activeMode = mode;
        ui.setCaption(FREE_CAMERA_CAPTION);
      },
      measureCost: () => view?.measureCost() ?? null,
    };
  }

  return () => {
    view?.dispose();
    view = null;
    ui.dispose();
    if (import.meta.env.DEV) delete window.__cinema;
  };
}
