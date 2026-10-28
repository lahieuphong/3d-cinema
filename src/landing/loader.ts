/** A module (or anything) loaded at most once at a time, with an optional early start. */
export interface Loader<T> {
  /** The value; concurrent calls share one request. A failure is forgotten, so the next call tries again. */
  get(): Promise<T>;
  /** Starts loading early (the user is about to need it); failures here stay quiet. */
  preload(): void;
  readonly state: 'idle' | 'loading' | 'loaded';
}

export function createLoader<T>(load: () => Promise<T>): Loader<T> {
  let pending: Promise<T> | null = null;
  let state: Loader<T>['state'] = 'idle';
  const get = () => {
    if (!pending) {
      state = 'loading';
      pending = load().then(
        (value) => {
          state = 'loaded';
          return value;
        },
        (error: unknown) => {
          pending = null;
          state = 'idle';
          throw error;
        },
      );
    }
    return pending;
  };
  return {
    get,
    preload() {
      // An early start that fails must not surface as an unhandled rejection; the click retries.
      get().catch(() => {});
    },
    get state() {
      return state;
    },
  };
}

/** The browser asks pages to save data (Save-Data / Data Saver): no speculative downloads then. */
export function savesData(nav: Navigator = navigator): boolean {
  return Boolean((nav as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
}
