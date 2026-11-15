/**
 * Pure player state. No DOM, no audio, no timers — so it can be tested with
 * `node --test` and every transition is reproducible.
 */

export const STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  PLAYING: "playing",
  PAUSED: "paused",
  ERROR: "error",
});

export const DEFAULT_VOLUME = 0.7;

/** Clamp to 0..1, falling back for NaN/strings that cannot be read as a number. */
export function clampVolume(value, fallback = DEFAULT_VOLUME) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

/** Wrap any integer into 0..length-1. Returns -1 for an unusable length. */
export function wrapIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  const i = Number.isInteger(index) ? index : 0;
  return ((i % length) + length) % length;
}

export function createState({ channels = [], index = 0, volume = DEFAULT_VOLUME, muted = false, dead = [] } = {}) {
  const length = channels.length;
  const cleanDead = [...new Set(Array.isArray(dead) ? dead : [])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < length);

  return {
    index: wrapIndex(index, length),
    status: STATUS.IDLE,
    volume: clampVolume(volume),
    muted: Boolean(muted),
    dead: cleanDead,
    error: null,
  };
}

export function isDead(state, index) {
  return state.dead.includes(index);
}

/**
 * Next index that is not marked dead, moving one step at a time and wrapping.
 * `from` may be -1 when nothing is selected yet. Returns -1 when every station
 * is dead.
 */
export function nextPlayable(channels, from, dead = [], direction = 1) {
  const length = channels.length;
  if (!length) return -1;

  const dir = direction < 0 ? -1 : 1;
  let cursor = from < 0 ? wrapIndex(dir > 0 ? 0 : length - 1, length) : wrapIndex(from + dir, length);

  for (let visited = 0; visited < length; visited += 1) {
    if (!dead.includes(cursor)) return cursor;
    cursor = wrapIndex(cursor + dir, length);
  }
  return -1;
}

/** Jump straight to an index. Keeps the current playback status. */
export function selectStation(state, channels, index) {
  const wrapped = wrapIndex(index, channels.length);
  if (wrapped === -1) return { ...state, error: "No stations available", status: STATUS.ERROR };
  return { ...state, index: wrapped, error: null };
}

/** Move by one station, skipping dead ones. */
export function tune(state, channels, direction = 1) {
  const target = nextPlayable(channels, state.index, state.dead, direction);
  if (target === -1) {
    return {
      ...state,
      status: STATUS.ERROR,
      error: "Every station is offline",
    };
  }
  return { ...state, index: target, error: null };
}

export function markDead(state, channels, index) {
  // Deliberately does not wrap: an out-of-range index here means the caller is
  // confused, and marking a different station dead would hide the bug.
  if (!Number.isInteger(index) || index < 0 || index >= channels.length) return state;
  if (state.dead.includes(index)) return state;
  return { ...state, dead: [...state.dead, index] };
}

export function setVolume(state, value) {
  return { ...state, volume: clampVolume(value, state.volume) };
}

export function toggleMute(state) {
  return { ...state, muted: !state.muted };
}

export function channelAt(channels, index) {
  return channels[index] ?? null;
}

export function formatVolume(state) {
  const pct = Math.round((state.muted ? 0 : state.volume) * 100);
  return `${pct}%`;
}

/** Label shown under the dial. */
export function statusLabel(state) {
  switch (state.status) {
    case STATUS.LOADING: return "TUNING";
    case STATUS.PLAYING: return "ON AIR";
    case STATUS.PAUSED: return "PAUSED";
    case STATUS.ERROR: return state.error ?? "OFFLINE";
    default: return "READY";
  }
}
