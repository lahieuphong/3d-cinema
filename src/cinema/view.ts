import { Scene, WebGLRenderer } from 'three';
import { buildArchitecture, type Architecture, type ToggleablePart } from './architecture.ts';
import { CameraRig } from './cameraRig.ts';
import { computePresetPose, type CameraPose, type CameraPresetId } from './cameraPresets.ts';
import type { AuditoriumLayout } from './layout.ts';
import { createLighting, type Lighting } from './lighting.ts';
import { createBlockoutMaterials, disposeMaterials, type BlockoutMaterials } from './materials.ts';
import { createPlaceholderSeatModel, createSeatInstances, type SeatInstances, type SeatModel } from './seats.ts';

export type ViewStatus = { kind: 'ready' } | { kind: 'context-lost' } | { kind: 'error'; message: string };

export interface CinemaViewCallbacks {
  onStatus(status: ViewStatus): void;
  onTransitionChange(active: boolean): void;
  /** The user started orbiting, zooming or panning by hand. */
  onManualCamera(): void;
}

/** Thrown when the browser cannot provide the WebGL 2 context three.js needs. */
export class WebGLUnavailableError extends Error {
  override name = 'WebGLUnavailableError';
}

/**
 * Owns the renderer, scene and camera rig for one mounted viewport.
 * Renders on demand: a frame is scheduled only when something changed, and frames keep coming
 * only while a preset transition or orbit damping is still moving the camera.
 */
export class CinemaView {
  readonly layout: AuditoriumLayout;
  private readonly container: HTMLElement;
  private readonly callbacks: CinemaViewCallbacks;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly materials: BlockoutMaterials;
  private readonly architecture: Architecture;
  private readonly seatModel: SeatModel;
  private readonly seatInstances: SeatInstances;
  private readonly lighting: Lighting;
  private readonly resizeObserver: ResizeObserver;
  private frameId: number | null = null;
  private renderedOnce = false;
  private reportedTransition = false;
  private disposed = false;

  constructor(container: HTMLElement, layout: AuditoriumLayout, callbacks: CinemaViewCallbacks) {
    this.container = container;
    this.layout = layout;
    this.callbacks = callbacks;
    const { config } = layout;

    if (typeof WebGL2RenderingContext === 'undefined') {
      throw new WebGLUnavailableError('Trình duyệt này không hỗ trợ WebGL 2.');
    }
    try {
      this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (cause) {
      throw new WebGLUnavailableError('Không tạo được ngữ cảnh WebGL. Tăng tốc phần cứng có thể đang bị tắt.', { cause });
    }
    this.renderer.setClearColor(config.render.background);

    const canvas = this.renderer.domElement;
    canvas.className = 'cinema-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Khung nhìn 3D của phòng chiếu. Kéo để xoay, cuộn hoặc chụm để thu phóng.');
    container.append(canvas);

    try {
      this.materials = createBlockoutMaterials();
      this.architecture = buildArchitecture(layout, this.materials);
      this.seatModel = createPlaceholderSeatModel(config, this.materials);
      this.seatInstances = createSeatInstances(this.seatModel, layout.seats);
      this.lighting = createLighting(layout);
      this.scene.add(this.architecture.group, this.seatInstances.group, this.lighting.group);

      const { interior } = layout;
      this.rig = new CameraRig(config, canvas, {
        x: (interior.x.min + interior.x.max) / 2,
        y: (interior.y.min + interior.y.max) / 2,
        z: (interior.z.min + interior.z.max) / 2,
      });
    } catch (error) {
      // Nothing else holds the renderer yet; release it so a failed mount leaves no canvas or context.
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      canvas.remove();
      throw error;
    }
    this.rig.controls.addEventListener('change', this.requestRender);
    this.rig.controls.addEventListener('start', this.handleControlsStart);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Moves the camera to a preset (animated unless the user prefers reduced motion). */
  setPreset(id: CameraPresetId, animate: boolean): CameraPose {
    const pose = computePresetPose(id, this.layout, this.rig.camera.aspect);
    this.rig.moveTo(pose, animate && !prefersReducedMotion());
    this.reportTransition();
    this.requestRender();
    return pose;
  }

  setPartVisible(part: ToggleablePart, visible: boolean): void {
    this.architecture.toggleable[part].visible = visible;
    this.requestRender();
  }

  /** Snapshot for development tooling and automated checks. */
  getDebugState() {
    const { camera, controls } = this.rig;
    const info = this.renderer.info;
    return {
      mode: this.rig.mode,
      transitioning: this.rig.isTransitioning,
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, aspect: camera.aspect },
      drawingBuffer: { width: this.renderer.domElement.width, height: this.renderer.domElement.height },
      pixelRatio: this.renderer.getPixelRatio(),
      render: { calls: info.render.calls, triangles: info.render.triangles },
      memory: { geometries: info.memory.geometries, textures: info.memory.textures },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;

    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.rig.controls.removeEventListener('change', this.requestRender);
    this.rig.controls.removeEventListener('start', this.handleControlsStart);
    this.rig.dispose();

    // Each owner releases what it created; shared materials go last, after every user is gone.
    this.scene.clear();
    this.seatInstances.dispose();
    this.seatModel.dispose();
    this.architecture.dispose();
    this.lighting.dispose();
    disposeMaterials(this.materials);

    this.renderer.dispose();
    // Release the GL context now instead of waiting for GC, so remounts never pile up contexts.
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  private readonly requestRender = (): void => {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (time: number): void => {
    this.frameId = null;
    const needsAnotherFrame = this.rig.update(time);
    this.renderer.render(this.scene, this.rig.camera);
    this.reportTransition();
    if (!this.renderedOnce) {
      this.renderedOnce = true;
      this.callbacks.onStatus({ kind: 'ready' });
    }
    if (needsAnotherFrame) this.requestRender();
  };

  private readonly resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    // Re-read the device pixel ratio: it changes with browser zoom and when moving between screens.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.layout.config.render.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.requestRender();
  };

  private readonly handleControlsStart = (): void => {
    this.callbacks.onManualCamera();
  };

  private readonly handleContextLost = (): void => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.callbacks.onStatus({ kind: 'context-lost' });
  };

  private readonly handleContextRestored = (): void => {
    this.callbacks.onStatus({ kind: 'ready' });
    this.requestRender();
  };

  private reportTransition(): void {
    const active = this.rig.isTransitioning;
    if (active === this.reportedTransition) return;
    this.reportedTransition = active;
    this.callbacks.onTransitionChange(active);
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
