import '../styles.css';
import { PAGE_TITLES } from '../brand.ts';
import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { CameraRig } from './cameraRig.ts';
import { AUDITORIUM_CONFIG } from './config.ts';
import { createInteriorEnvironment, type InteriorEnvironment } from './environment.ts';
import { toRadians, type SeatData, type Vec3 } from './layout.ts';
import { createStudioLighting, type StudioLighting } from './lighting.ts';
import { createSeatMaterials, disposeMaterials, type SeatMaterials } from './materials.ts';
import { loadQuality, QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import { prefersReducedMotion, RenderHost, WebGLUnavailableError, type ViewStatus } from './renderHost.ts';
import { computeSeatModelBounds, createCinemaSeatModel, createSeatInstances, type SeatInstances, type SeatModel } from './seats.ts';
import { CLOSE_ICON, el, icon, ICONS, renderStatus, switchControl } from './ui.ts';

/**
 * Development seat inspector (/cinema?inspect=seat): the auditorium's seat model on a neutral
 * floor, turned and zoomed by hand (it opens at a front three-quarter view), with an optional
 * three-seat cluster, footprint and measured dimensions, at either quality level. It uses the same
 * SeatModel, materials, instancing, tone mapping and reflection environment as the auditorium, under
 * neutral studio lighting, and replaces the auditorium while open, so only one renderer ever exists.
 *
 * The page keeps to its title, "Tùy chọn" (the switches and the quality, in one small panel) and
 * "Đóng"; over the view a hand shows that the seat turns, until the view is first touched.
 */

/** Framed views: the opening one, and the rest for `yarn capture` (dev hook; no buttons). */
export type InspectorViewId = 'front' | 'side' | 'back' | 'top' | 'cup';

/** A pointing hand under a two-headed arc: "drag to turn". Decorative (the words are kept for screen readers). */
const TURN_HINT_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
  '<g class="cinema-gesture__arc"><path d="M13 17C21 9 43 9 51 17"/><path d="M13 17l1.2-6.4M13 17l6.4 1.4"/><path d="M51 17l-1.2-6.4M51 17l-6.4 1.4"/></g>' +
  '<g transform="translate(8 15)"><path class="cinema-gesture__hand" d="M20 31V9.5a3 3 0 0 1 6 0v11a3 3 0 0 1 6 0v1.5a3 3 0 0 1 6 0v2a3 3 0 0 1 6 0V33c0 7-5 12-12 12h-5.5c-4.4 0-7.3-1.8-9.7-5.2L11 32.5a3 3 0 0 1 4.6-3.8L20 33z"/></g>' +
  '</svg>';

const config = AUDITORIUM_CONFIG;
const inspector = config.inspector;

/** Seats laid out like one auditorium row, centre seat first so drawing one instance shows it alone. */
function createInspectorSeats(): SeatData[] {
  const offsets = [0];
  for (let k = 1; offsets.length < inspector.clusterSize; k++) offsets.push(-k, k);
  const centre = Math.floor(inspector.clusterSize / 2);
  return offsets.slice(0, inspector.clusterSize).map((offset, index) => ({
    id: `X${String(centre + offset + 1).padStart(2, '0')}`,
    index,
    rowIndex: 0,
    columnIndex: centre + offset,
    rowLabel: 'X',
    seatNumber: centre + offset + 1,
    position: { x: offset * config.seating.seatPitch, y: 0, z: 0 },
    yaw: 0,
    floorY: 0,
  }));
}

interface InspectorViewCallbacks {
  onStatus(status: ViewStatus): void;
  onTransitionChange(active: boolean): void;
}

/** Everything the inspector keeps on the GPU; rebuilt from scratch after a lost context comes back. */
interface InspectorContent {
  materials: SeatMaterials;
  model: SeatModel;
  instances: SeatInstances;
  modelBounds: Box3;
  lighting: StudioLighting;
  environment: InteriorEnvironment;
  backdrop: CanvasTexture;
  floor: Mesh<CircleGeometry, MeshStandardMaterial>;
  grid: LineSegments<BufferGeometry, LineBasicMaterial>;
  footprint: LineSegments<BufferGeometry, LineBasicMaterial>;
  boundsBox: LineSegments<BufferGeometry, LineBasicMaterial>;
}

class SeatInspectorView {
  private readonly host: RenderHost;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly callbacks: InspectorViewCallbacks;
  private readonly seats = createInspectorSeats();
  private content: InspectorContent;
  private quality: QualityLevel;
  private cluster = false;
  private reportedTransition = false;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: InspectorViewCallbacks, quality: QualityLevel) {
    this.callbacks = callbacks;
    this.quality = quality;
    this.host = new RenderHost(container, {
      background: inspector.background,
      maxPixelRatio: config.quality[quality].maxPixelRatio,
      ariaLabel: 'Khung nhìn 3D của mẫu ghế. Kéo để xoay, cuộn hoặc chụm để thu phóng.',
      onResize: (width, height) => this.rig.setAspect(width / height),
      onFrame: (_time, dt) => this.renderFrame(dt),
      onStatus: (status) => callbacks.onStatus(status),
      onContextRestored: () => this.handleContextRestored(),
      textureProbe: () => this.content?.materials.upholstery,
    });
    const { renderer } = this.host;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = config.render.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    try {
      this.content = this.buildContent(quality);
      this.rig = new CameraRig(inspector.camera, this.host.canvas, this.focusCentre());
    } catch (error) {
      this.host.dispose();
      throw error;
    }
    this.setCluster(false);
    renderer.shadowMap.needsUpdate = true;
    this.rig.controls.addEventListener('change', this.host.requestRender);
    this.host.start();
  }

  setView(id: InspectorViewId, animate: boolean): void {
    const camera = inspector.camera;
    const direction = new Vector3().copy(camera.views[id]).normalize();
    let target: Vector3;
    let distance: number;
    if (id === 'cup') {
      target = this.content.model.cupHolder.center.clone();
      distance = camera.cupDistance;
    } else {
      const sphere = this.visibleBounds().getBoundingSphere(new Sphere());
      target = sphere.center;
      // Fit the bounding sphere inside the narrower of the two fields of view.
      const vertical = toRadians(this.rig.camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.rig.camera.aspect);
      distance = (sphere.radius * camera.fitMargin) / Math.sin(Math.min(vertical, horizontal) / 2);
    }
    const position = target.clone().addScaledVector(direction, distance);
    this.rig.moveTo({ position, lookAt: target, mode: 'orbit' }, animate && !prefersReducedMotion());
    this.reportTransition();
    this.host.requestRender();
  }

  /** Shows the centre seat alone or the whole cluster at the auditorium's seat pitch. */
  setCluster(on: boolean): void {
    this.cluster = on;
    const count = on ? this.seats.length : 1;
    for (const mesh of this.content.instances.meshes) mesh.count = count;
    this.content.footprint.geometry.setDrawRange(0, 8 * count);
    this.invalidateShadows();
  }

  /** Rebuilds the seats at the other level of detail, keeping view, cluster and overlays. */
  setQuality(level: QualityLevel): void {
    if (level === this.quality || this.disposed) return;
    this.quality = level;
    const content = this.content;
    this.scene.remove(content.instances.group);
    content.instances.dispose();
    content.model.dispose();
    [content.model, content.instances] = this.buildSeats(content.materials, level);
    content.modelBounds = computeSeatModelBounds(content.model);
    content.boundsBox.geometry.dispose();
    content.boundsBox.geometry = boxEdgesGeometry(content.modelBounds);
    this.scene.add(content.instances.group);
    this.setCluster(this.cluster);
    content.lighting.setShadowQuality(config.quality[level].shadowMapSize, config.quality[level].shadowRadius);
    this.host.setMaxPixelRatio(config.quality[level].maxPixelRatio);
    this.invalidateShadows();
  }

  setFootprintVisible(visible: boolean): void {
    this.content.footprint.visible = visible;
    this.host.requestRender();
  }

  setBoundsVisible(visible: boolean): void {
    this.content.boundsBox.visible = visible;
    this.host.requestRender();
  }

  /** Dimensions measured from the built geometry, in metres. */
  measure() {
    const { model, modelBounds } = this.content;
    const size = modelBounds.getSize(new Vector3());
    const component = (name: string) => model.components.find((c) => c.name === name)!.bounds;
    const cushion = component('cushion');
    const armrest = component('armrest-left');
    return {
      width: size.x,
      depth: size.z,
      height: size.y,
      seatHeight: cushion.max.y,
      cushionWidth: cushion.max.x - cushion.min.x,
      armrestHeight: armrest.max.y,
      gapToNeighbour: config.seating.seatPitch - size.x,
      footprint: { width: config.seat.footprintWidth, depth: config.seat.footprintDepth },
      reclineDeg: config.seat.model.backrest.reclineDeg,
    };
  }

  getDebugState() {
    const { camera, controls } = this.rig;
    return {
      cluster: this.cluster,
      footprint: this.content.footprint.visible,
      bounds: this.content.boundsBox.visible,
      transitioning: this.rig.isTransitioning,
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, aspect: camera.aspect },
      seats: this.content.instances.meshes[0].count,
      quality: this.quality,
      trianglesPerSeat: this.content.model.parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? 0) / 3, 0),
      measured: this.measure(),
      ...this.host.getDebugInfo(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rig.controls.removeEventListener('change', this.host.requestRender);
    this.rig.dispose();
    this.scene.clear();
    this.scene.environment = null;
    this.scene.background = null;
    const { instances, model, materials, lighting, environment, backdrop, floor, footprint, boundsBox, grid } = this.content;
    backdrop.dispose();
    instances.dispose();
    model.dispose();
    disposeMaterials(materials);
    lighting.dispose();
    environment.dispose();
    floor.material.map?.dispose();
    floor.material.alphaMap?.dispose();
    for (const object of [floor, grid, footprint, boundsBox]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.host.dispose();
  }

  private visibleBounds(): Box3 {
    const bounds = new Box3();
    const count = this.cluster ? this.seats.length : 1;
    for (const seat of this.seats.slice(0, count)) {
      bounds.union(this.content.modelBounds.clone().translate(new Vector3(seat.position.x, seat.position.y, seat.position.z)));
    }
    return bounds;
  }

  private focusCentre(): Vec3 {
    const centre = this.content.modelBounds.getCenter(new Vector3());
    return { x: centre.x, y: centre.y, z: centre.z };
  }

  private buildContent(quality: QualityLevel): InspectorContent {
    const materials = createSeatMaterials();
    const [model, instances] = this.buildSeats(materials, quality);
    const modelBounds = computeSeatModelBounds(model);
    const lighting = createStudioLighting();
    lighting.setShadowQuality(config.quality[quality].shadowMapSize, config.quality[quality].shadowRadius);
    const environment = createInteriorEnvironment(this.host.renderer);
    this.scene.environment = environment.texture;

    // Behind everything, a soft warm glow (an sRGB picture: drawn as is, not tone mapped), so the
    // seat's dark frame stands out from the stage.
    const [glow, edge] = inspector.backdropColours;
    const backdrop = radialTexture([[0, glow], [1, edge]]);
    backdrop.colorSpace = SRGBColorSpace;
    this.scene.background = backdrop;

    // The stage: a warm pool of light under the seat that fades into the background (it still takes
    // the seat's shadow). Pushed back in depth so lines drawn at floor level stay on top.
    const [centre, middle, outer] = inspector.floorColours;
    const floorColour = radialTexture([[0, centre], [0.3, middle], [1, outer]]);
    floorColour.colorSpace = SRGBColorSpace;
    const floor = new Mesh(
      new CircleGeometry(inspector.floorRadius, 96),
      new MeshStandardMaterial({
        map: floorColour,
        alphaMap: radialTexture([[0, '#fff'], [0.3, '#fff'], [0.85, '#000']]),
        transparent: true,
        roughness: 0.92,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const grid = fadingGrid();
    grid.renderOrder = 1;
    // Overlays in the site's accents: the footprint in champagne, the bounds in warm white.
    const footprint = new LineSegments(footprintGeometry(this.seats), new LineBasicMaterial({ color: 0xd9b46a }));
    const boundsBox = new LineSegments(boxEdgesGeometry(modelBounds), new LineBasicMaterial({ color: 0xf1e4c8 }));
    footprint.visible = false;
    boundsBox.visible = false;
    this.scene.add(floor, grid, footprint, boundsBox, instances.group, lighting.group);
    return { materials, model, instances, modelBounds, lighting, environment, backdrop, floor, grid, footprint, boundsBox };
  }

  private buildSeats(materials: SeatMaterials, level: QualityLevel): [SeatModel, SeatInstances] {
    const model = createCinemaSeatModel(config, materials, config.quality[level].seat);
    const instances = createSeatInstances(model, this.seats);
    for (const mesh of instances.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return [model, instances];
  }

  /**
   * Rebuilds every GPU resource after a lost context comes back and drops the old ones without
   * disposing them (see CinemaView.handleContextRestored for why), keeping cluster and overlays.
   */
  private handleContextRestored(): void {
    const old = this.content;
    this.scene.remove(old.floor, old.grid, old.footprint, old.boundsBox, old.instances.group, old.lighting.group);
    this.content = this.buildContent(this.quality);
    this.content.footprint.visible = old.footprint.visible;
    this.content.boundsBox.visible = old.boundsBox.visible;
    this.setCluster(this.cluster);
  }

  private invalidateShadows(): void {
    this.host.renderer.shadowMap.needsUpdate = true;
    this.host.requestRender();
  }

  private renderFrame(dt: number): boolean {
    const needsAnotherFrame = this.rig.update(dt);
    this.host.renderer.render(this.scene, this.rig.camera);
    this.reportTransition();
    return needsAnotherFrame;
  }

  private reportTransition(): void {
    const active = this.rig.isTransitioning;
    if (active === this.reportedTransition) return;
    this.reportedTransition = active;
    this.callbacks.onTransitionChange(active);
  }
}

/** A radial gradient from the centre to the rim on a small canvas (the floor's colour and its fade). */
function radialTexture(stops: ReadonlyArray<readonly [number, string]>): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(canvas);
}

/**
 * The 10 cm grid, just above the floor, fading out with the distance from the seat: each line is cut
 * into short pieces so its alpha (per vertex) can follow that distance.
 */
function fadingGrid(): LineSegments<BufferGeometry, LineBasicMaterial> {
  const { gridSize: size, gridDivisions: divisions, grid } = inspector;
  const half = size / 2;
  const pieces = 32;
  const y = 0.001;
  const [r, g, b] = new Color(grid.colour).toArray();
  const alpha = (x: number, z: number) => {
    const t = Math.min(Math.max((Math.hypot(x, z) - grid.fadeFrom) / (grid.fadeTo - grid.fadeFrom), 0), 1);
    return grid.opacity * (1 - t * t * (3 - 2 * t));
  };
  const positions: number[] = [];
  const colours: number[] = [];
  for (let i = 0; i <= divisions; i++) {
    const c = -half + (size * i) / divisions;
    for (let k = 0; k < pieces; k++) {
      const a = -half + (size * k) / pieces;
      const e = -half + (size * (k + 1)) / pieces;
      for (const [x1, z1, x2, z2] of [[a, c, e, c], [c, a, c, e]]) {
        positions.push(x1, y, z1, x2, y, z2);
        colours.push(r, g, b, alpha(x1, z1), r, g, b, alpha(x2, z2));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 4));
  return new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
}

/** One footprint rectangle per seat, just above the floor. */
function footprintGeometry(seats: SeatData[]): BufferGeometry {
  const halfW = config.seat.footprintWidth / 2;
  const halfD = config.seat.footprintDepth / 2;
  const y = 0.002;
  const positions: number[] = [];
  for (const { position: p } of seats) {
    const corners = [
      [p.x - halfW, p.z - halfD],
      [p.x + halfW, p.z - halfD],
      [p.x + halfW, p.z + halfD],
      [p.x - halfW, p.z + halfD],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      positions.push(ax, y, az, bx, y, bz);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function boxEdgesGeometry(box: Box3): BufferGeometry {
  const { min, max } = box;
  const c = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [min.x, min.y, max.z],
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
  ];
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(edges.flatMap((i) => c[i]), 3));
  return geometry;
}

const millimetreFormat = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
// A no-break space: the unit never ends up alone on the next line in a narrow panel.
const metres = (value: number) => `${millimetreFormat.format(value)} m`;

declare global {
  interface Window {
    /** Development-only inspection hook used by `yarn capture` (it also frames the fixed views). */
    __seatInspector?: { getState(): unknown; setView(id: InspectorViewId): void };
  }
}

/** Mounts the seat inspector into `host`. Returns a function that tears everything down. */
export function mountSeatInspector(host: HTMLElement, { onClose }: { onClose(): void }): () => void {
  document.title = PAGE_TITLES.inspector;
  const listeners = new AbortController();
  const { signal } = listeners;

  const root = el('div', 'cinema-app cinema-app--inspector');
  const header = el('header', 'cinema-header');
  const title = el('h1', 'cinema-title', 'Duyệt mẫu ghế');
  title.append(' ', el('span', 'cinema-badge', 'Chế độ phát triển'));
  // "Tùy chọn" opens the panel below it (a disclosure: the switches stay in the tab order after it).
  const optionsButton = el('button', 'cinema-button cinema-inspector__options-toggle');
  optionsButton.type = 'button';
  optionsButton.id = 'cinema-inspector-options-toggle';
  optionsButton.dataset.action = 'inspector-options';
  optionsButton.setAttribute('aria-expanded', 'false');
  optionsButton.setAttribute('aria-controls', 'cinema-inspector-options');
  optionsButton.append(icon(ICONS.settings), el('span', '', 'Tùy chọn'));
  const closeButton = el('button', 'cinema-button');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.append(icon(CLOSE_ICON), el('span', '', 'Đóng'));
  closeButton.addEventListener('click', () => onClose(), { signal });
  const actions = el('div', 'cinema-inspector__actions');
  actions.append(optionsButton, closeButton);

  // The panel: the same rows as Cài đặt (label left, control right), no card per row.
  const options = el('div', 'cinema-inspector__options');
  options.id = 'cinema-inspector-options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-labelledby', optionsButton.id);
  options.hidden = true;
  const qualityRow = el('div', 'cinema-hub__row cinema-hub__row--quality');
  const qualityHeading = el('span', 'cinema-hub__label', 'Chất lượng');
  qualityHeading.id = 'cinema-inspector-quality';
  const qualityGroup = el('div', 'cinema-segmented');
  qualityGroup.setAttribute('role', 'group');
  qualityGroup.setAttribute('aria-labelledby', qualityHeading.id);
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const button = el('button', 'cinema-segmented__button', QUALITY_LABELS[level]);
    button.type = 'button';
    button.dataset.quality = level;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setQuality(level), { signal });
    qualityButtons.set(level, button);
    qualityGroup.append(button);
  }
  qualityRow.append(qualityHeading, qualityGroup);
  const clusterSwitch = switchControl(`${inspector.clusterSize} ghế`, 'cluster', false, (on) => setCluster(on), signal);
  const footprintSwitch = switchControl('Footprint', 'footprint', false, (on) => setFootprint(on), signal);
  const dimensionsSwitch = switchControl('Kích thước', 'dimensions', false, (on) => setDimensions(on), signal);
  const rows = el('div', 'cinema-hub__rows');
  for (const switchRow of [clusterSwitch, footprintSwitch, dimensionsSwitch]) switchRow.wrapper.classList.add('cinema-hub__row');
  rows.append(qualityRow, clusterSwitch.wrapper, footprintSwitch.wrapper, dimensionsSwitch.wrapper);
  options.append(rows);
  header.append(title, actions, options);

  const stage = el('main', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const dimensions = el('dl', 'cinema-dimensions');
  dimensions.hidden = true;
  // The words are for screen readers; on screen a hand shows the seat turns, until it is touched.
  const description = el(
    'p',
    'visually-hidden',
    'Cùng mẫu ghế và vật liệu với 110 ghế trong khán phòng. Kéo để xoay, cuộn hoặc chụm để thu phóng. Esc để đóng.',
  );
  const gesture = el('div', 'cinema-gesture');
  gesture.innerHTML = TURN_HINT_SVG;
  const status = el('div', 'cinema-status');
  stage.append(viewport, dimensions, gesture, description, status);
  root.append(header, stage);
  host.replaceChildren(root);

  // The first touch, drag or wheel on the view: the hand has done its job and leaves for good.
  const dismissGesture = () => {
    if (gesture.dataset.gone === 'true') return;
    gesture.dataset.gone = 'true';
    gesture.addEventListener('transitionend', () => gesture.remove(), { once: true, signal });
    window.setTimeout(() => gesture.remove(), 400);
  };
  for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) {
    viewport.addEventListener(type, dismissGesture, { signal, passive: true, capture: true });
  }

  const setOptions = (open: boolean, focusToggle = false) => {
    options.hidden = !open;
    optionsButton.setAttribute('aria-expanded', String(open));
    if (!open && focusToggle) optionsButton.focus();
  };
  optionsButton.addEventListener('click', () => setOptions(optionsButton.getAttribute('aria-expanded') !== 'true'), { signal });
  // A press anywhere else closes the panel (and still does what it does there).
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!options.hidden && !options.contains(event.target as Node) && !optionsButton.contains(event.target as Node)) setOptions(false);
    },
    { signal, capture: true },
  );

  const controls = [optionsButton, clusterSwitch.input, footprintSwitch.input, dimensionsSwitch.input, ...qualityButtons.values()];
  const setStatus = (next: Parameters<typeof renderStatus>[2]) => {
    renderStatus(root, status, next);
    if (next.kind === 'error') for (const control of controls) control.disabled = true;
  };
  setStatus({ kind: 'loading' });
  root.dataset.transitioning = 'false';

  let view: SeatInspectorView | null = null;
  const initialQuality = loadQuality().level;
  let activeView: InspectorViewId = 'front';

  function selectView(id: InspectorViewId, animate: boolean) {
    activeView = id;
    root.dataset.view = id;
    view?.setView(id, animate);
  }
  function setCluster(on: boolean) {
    root.dataset.cluster = String(on);
    view?.setCluster(on);
    // Re-frame so the whole cluster (or the single seat) fills the view.
    if (activeView !== 'cup') selectView(activeView, true);
  }
  function setFootprint(on: boolean) {
    root.dataset.footprint = String(on);
    view?.setFootprintVisible(on);
  }
  // Compares the two levels here; the auditorium's stored choice is left alone.
  function setQuality(level: QualityLevel) {
    root.dataset.quality = level;
    for (const [value, button] of qualityButtons) button.setAttribute('aria-pressed', String(value === level));
    view?.setQuality(level);
  }
  function setDimensions(on: boolean) {
    root.dataset.dimensions = String(on);
    dimensions.hidden = !on;
    view?.setBoundsVisible(on);
  }

  // Escape closes the panel first (focus back on "Tùy chọn"), then the page.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      if (!options.hidden) setOptions(false, true);
      else onClose();
    },
    { signal },
  );

  try {
    view = new SeatInspectorView(viewport, {
      onStatus: (next) => setStatus(next),
      onTransitionChange: (active) => (root.dataset.transitioning = String(active)),
    }, initialQuality);
    const m = view.measure();
    dimensions.replaceChildren(
      ...[
        ['Rộng × sâu × cao', `${metres(m.width)} × ${metres(m.depth)} × ${metres(m.height)}`],
        ['Footprint', `${metres(m.footprint.width)} × ${metres(m.footprint.depth)}`],
        ['Khe với ghế bên cạnh', metres(m.gapToNeighbour)],
        ['Mặt ngồi cao', metres(m.seatHeight)],
        ['Đệm ngồi rộng', metres(m.cushionWidth)],
        ['Tay vịn cao', metres(m.armrestHeight)],
        ['Tựa lưng ngả', `${m.reclineDeg}°`],
      ].flatMap(([term, value]) => [el('dt', '', term), el('dd', '', value)]),
    );
    // The view starts with one seat and no overlays; mirror that before the first frame.
    root.dataset.cluster = 'false';
    root.dataset.footprint = 'false';
    root.dataset.dimensions = 'false';
    setQuality(initialQuality);
    selectView(activeView, false);
  } catch (error) {
    console.error('[cinema] Could not start the seat inspector:', error);
    const message =
      error instanceof WebGLUnavailableError ? error.message : 'Đã xảy ra lỗi khi dựng cảnh. Xem chi tiết trong console.';
    setStatus({ kind: 'error', message });
  }

  if (import.meta.env.DEV) {
    window.__seatInspector = {
      getState: () => ({ view: activeView, canvasCount: document.querySelectorAll('canvas').length, inspector: view?.getDebugState() ?? null }),
      setView: (id) => selectView(id, true),
    };
  }

  return () => {
    listeners.abort();
    view?.dispose();
    view = null;
    root.remove();
    if (import.meta.env.DEV) delete window.__seatInspector;
  };
}
