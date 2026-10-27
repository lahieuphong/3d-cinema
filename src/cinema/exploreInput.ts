import type { MoveIntent } from './walker.ts';

/** Movement keys by physical position (`event.code`), so WASD works on any keyboard layout. */
const KEYS: Record<string, keyof MoveIntent | `-${keyof MoveIntent}`> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: '-forward',
  ArrowDown: '-forward',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyA: '-right',
  ArrowLeft: '-right',
};

export function isMovementKey(event: KeyboardEvent): boolean {
  return event.code in KEYS;
}

/**
 * True when a key press belongs to whatever has focus: text fields, selects, editable content and
 * widgets that use arrow keys themselves. Modifier combinations are left to the browser too.
 */
export function keyBelongsToFocus(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return true;
  const target = event.target as HTMLElement | null;
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // Panels that keep the keyboard for their own controls (the film player).
  if (target.closest('[data-keys="own"]')) return true;
  // Composite widgets that move focus with arrow keys themselves (the seat map is a grid).
  if (target.closest('[role="grid"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="menu"]')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)) return true;
  const role = target.getAttribute('role');
  return role !== null && ['slider', 'spinbutton', 'listbox', 'option', 'radio', 'tab', 'menuitem', 'combobox', 'textbox', 'grid'].includes(role);
}

export interface ExploreInputOptions {
  /** Radians of turn per CSS pixel dragged. */
  lookPerPixel: number;
  /** Something changed: schedule a frame. */
  onInput(): void;
}

/**
 * Input for explore mode, owned by the auditorium view:
 * - keyboard: WASD or arrow keys (ignored while focus is in a field or a widget that needs them);
 * - look: drag on the canvas with a mouse, pen or finger;
 * - move on touch screens: an on-screen stick in the lower left of the viewport.
 * Each pointer belongs to exactly one of stick or look, so a thumb on the stick and another finger
 * looking around work together. Held keys and pointers are dropped on blur, when the tab is
 * hidden, on pointercancel and when the mode is switched off, so nothing keeps moving by itself.
 */
export class ExploreInput {
  readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly options: ExploreInputOptions;
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  private active = false;
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private look = { yaw: 0, pitch: 0 };
  private stickPointer: number | null = null;
  private stickVector = { forward: 0, right: 0 };

  constructor(canvas: HTMLElement, overlay: HTMLElement, options: ExploreInputOptions) {
    this.canvas = canvas;
    this.options = options;
    const { signal } = this.listeners;

    this.stick = document.createElement('div');
    this.stick.className = 'cinema-stick';
    this.stick.hidden = true;
    this.stick.setAttribute('role', 'group');
    this.stick.setAttribute('aria-label', 'Cần điều khiển di chuyển: kéo theo hướng muốn đi');
    this.knob = document.createElement('div');
    this.knob.className = 'cinema-stick__knob';
    this.stick.append(this.knob);
    overlay.append(this.stick);

    window.addEventListener('keydown', this.handleKeyDown, { signal });
    window.addEventListener('keyup', this.handleKeyUp, { signal });
    window.addEventListener('blur', this.clear, { signal });
    document.addEventListener('visibilitychange', () => document.hidden && this.clear(), { signal });

    canvas.addEventListener('pointerdown', this.handleLookDown, { signal });
    canvas.addEventListener('pointermove', this.handleLookMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, this.handleLookEnd, { signal });
    }
    this.stick.addEventListener('pointerdown', this.handleStickDown, { signal });
    this.stick.addEventListener('pointermove', this.handleStickMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.stick.addEventListener(type, this.handleStickEnd, { signal });
    }
  }

  /** Turns explore input on or off; `touchStick` shows the on-screen stick. */
  setActive(active: boolean, touchStick: boolean): void {
    this.active = active;
    this.stick.hidden = !(active && touchStick);
    if (!active) this.clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Combined movement from keys and stick, each axis in [−1, 1]. */
  intent(): MoveIntent {
    const key = (axis: keyof MoveIntent) =>
      Number([...this.keys].some((code) => KEYS[code] === axis)) - Number([...this.keys].some((code) => KEYS[code] === `-${axis}`));
    return {
      forward: clampUnit(key('forward') + this.stickVector.forward),
      right: clampUnit(key('right') + this.stickVector.right),
    };
  }

  /** Look-around accumulated since the last call (radians). */
  consumeLook(): { yaw: number; pitch: number } {
    const look = this.look;
    this.look = { yaw: 0, pitch: 0 };
    return look;
  }

  /** True while a key, the stick or a look drag is held. */
  get holding(): boolean {
    return this.keys.size > 0 || this.stickPointer !== null || this.lookPointer !== null;
  }

  /** Development: what is held, for automated checks. */
  debugState() {
    return { keys: [...this.keys], stick: this.stickPointer !== null, look: this.lookPointer !== null, intent: this.intent() };
  }

  readonly clear = (): void => {
    this.keys.clear();
    this.look = { yaw: 0, pitch: 0 };
    this.releasePointer(this.canvas, this.lookPointer);
    this.releasePointer(this.stick, this.stickPointer);
    this.lookPointer = null;
    this.stickPointer = null;
    this.stickVector = { forward: 0, right: 0 };
    this.knob.style.transform = '';
    this.options.onInput();
  };

  dispose(): void {
    this.listeners.abort();
    this.stick.remove();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || !isMovementKey(event) || keyBelongsToFocus(event)) return;
    event.preventDefault();
    if (!this.keys.has(event.code)) {
      this.keys.add(event.code);
      this.options.onInput();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (this.keys.delete(event.code)) this.options.onInput();
  };

  private readonly handleLookDown = (event: PointerEvent): void => {
    if (!this.active || this.lookPointer !== null || event.button > 0) return;
    this.lookPointer = event.pointerId;
    this.lookLast = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private readonly handleLookMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointer) return;
    const { lookPerPixel } = this.options;
    // Drag right to look right, drag down to look down (as when looking around from a seat).
    this.look.yaw -= (event.clientX - this.lookLast.x) * lookPerPixel;
    this.look.pitch -= (event.clientY - this.lookLast.y) * lookPerPixel;
    this.lookLast = { x: event.clientX, y: event.clientY };
    this.options.onInput();
  };

  private readonly handleLookEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointer) return;
    this.lookPointer = null;
    this.options.onInput();
  };

  private readonly handleStickDown = (event: PointerEvent): void => {
    if (!this.active || this.stickPointer !== null) return;
    event.preventDefault();
    this.stickPointer = event.pointerId;
    this.stick.setPointerCapture?.(event.pointerId);
    this.updateStick(event);
  };

  private readonly handleStickMove = (event: PointerEvent): void => {
    if (event.pointerId === this.stickPointer) this.updateStick(event);
  };

  private readonly handleStickEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickVector = { forward: 0, right: 0 };
    this.knob.style.transform = '';
    this.options.onInput();
  };

  private updateStick(event: PointerEvent): void {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width / 2;
    let x = (event.clientX - (rect.left + radius)) / radius;
    let y = (event.clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    // A small dead zone so resting a thumb on the stick does not creep.
    const live = Math.hypot(x, y) < 0.15 ? 0 : 1;
    this.stickVector = { forward: -y * live, right: x * live };
    this.knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    this.options.onInput();
  }

  private releasePointer(element: HTMLElement, pointerId: number | null): void {
    if (pointerId !== null && element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  }
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
