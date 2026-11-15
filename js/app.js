/**
 * DOM + audio layer.
 *
 * Everything that can be reasoned about without a browser lives in
 * `player-core.js`; this file only translates state into the DOM and translates
 * audio events back into state. Keep it boring — the reducer holds the logic.
 */
import { CHANNELS } from "./channels.js";
import {
  STATUS,
  createState,
  selectStation,
  markDead,
  setVolume as setVolumeState,
  toggleMute,
  channelAt,
  formatVolume,
  statusLabel,
  nextPlayable,
} from "./player-core.js";

const STORAGE_KEY = "outpost-radio:v1";
const RETRY_DELAY_MS = 900;
const SKIP_DELAY_MS = 550;

// ------------------------------------------------------------------ elements

const el = {
  audio: document.getElementById("audio"),
  play: document.getElementById("play"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  mute: document.getElementById("mute"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volume-value"),
  stations: document.getElementById("stations"),
  stationName: document.getElementById("station-name"),
  stationGroup: document.getElementById("station-group"),
  status: document.getElementById("status"),
  needle: document.getElementById("dial-needle"),
  toast: document.getElementById("toast"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  iconVolume: document.getElementById("icon-volume"),
  iconMuted: document.getElementById("icon-muted"),
};

// -------------------------------------------------------------------- storage

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ index: state.index, volume: state.volume, muted: state.muted }),
    );
  } catch {
    /* private mode / file:// — persistence is a nicety, not a requirement */
  }
}

// ---------------------------------------------------------------------- state

const saved = readSaved();

let state = createState({
  channels: CHANNELS,
  index: saved.index,
  volume: saved.volume,
  muted: saved.muted,
});

/** The user's intent, which is not the same as `audio.paused` during a load. */
let desiredPlaying = false;

/** Which station is actually in the <audio> element, and how the load is going. */
let attempt = { index: -1, retries: 0, token: 0 };

/** Pause events this soon after a new source are the browser swapping streams. */
let loadStartedAt = 0;

let lastRenderedIndex = -1;

// ---------------------------------------------------------------------- toast

let toastTimer = 0;

function showToast(message, ms = 3000) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), ms);
}

// --------------------------------------------------------------------- render

function render() {
  const channel = channelAt(CHANNELS, state.index);
  const showPause = state.status === STATUS.PLAYING || state.status === STATUS.LOADING;

  const name = channel?.name ?? "No station";
  const group = channel ? channel.group.toUpperCase() : "—";
  const statusText = state.status === STATUS.ERROR ? "OFFLINE" : statusLabel(state);

  // Only touch text when it changed: #station-name is aria-live, and re-writing
  // it on every volume tick would make screen readers announce it repeatedly.
  if (el.stationName.textContent !== name) el.stationName.textContent = name;
  if (el.stationGroup.textContent !== group) el.stationGroup.textContent = group;
  if (el.status.textContent !== statusText) el.status.textContent = statusText;
  el.status.dataset.status = state.status;

  document.body.dataset.state = state.status;

  // `hidden` is an HTMLElement IDL property, not an SVGElement one: assigning
  // `.hidden` on these inline <svg> icons sets an expando and never touches the
  // attribute. Toggle the attribute so the icon swap actually happens.
  el.iconPlay.toggleAttribute("hidden", showPause);
  el.iconPause.toggleAttribute("hidden", !showPause);
  el.play.setAttribute("aria-label", showPause ? "Pause" : "Play");
  el.play.title = showPause ? "Pause (space)" : "Play (space)";

  el.iconVolume.toggleAttribute("hidden", state.muted);
  el.iconMuted.toggleAttribute("hidden", !state.muted);
  el.mute.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
  el.mute.setAttribute("aria-pressed", String(state.muted));

  el.volume.value = String(Math.round(state.volume * 100));
  el.volumeValue.textContent = formatVolume(state);

  const count = CHANNELS.length || 1;
  const slot = ((state.index + 0.5) / count) * 100;
  el.needle.style.left = `${4 + slot * 0.92}%`;

  const previousIndex = lastRenderedIndex;
  lastRenderedIndex = state.index;
  // Never scroll on first paint — on a short screen that would yank the page
  // down to the station strip before the user has read anything.
  const shouldScroll = previousIndex !== -1 && previousIndex !== state.index;

  for (const chip of el.stations.children) {
    const index = Number(chip.dataset.index);
    const active = index === state.index;
    chip.classList.toggle("is-active", active);
    chip.classList.toggle("is-dead", state.dead.includes(index));
    chip.setAttribute("aria-pressed", String(active));

    // Keep the dialled station visible in the strip, without yanking the page.
    if (active && shouldScroll) {
      chip.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    }
  }

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = showPause ? "playing" : "paused";
  }

  document.title = showPause ? `▶ ${channel?.name ?? "Outpost Radio"}` : "Outpost Radio — live lofi";
}

// ------------------------------------------------------------------- stations

function buildStationList() {
  const fragment = document.createDocumentFragment();

  CHANNELS.forEach((channel, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.index = String(index);
    chip.dataset.group = channel.group;
    chip.title = `${channel.group} · ${channel.name}`;

    const dot = document.createElement("span");
    dot.className = "chip__dot";
    dot.setAttribute("aria-hidden", "true");

    chip.append(dot, document.createTextNode(channel.name));
    chip.addEventListener("click", () => {
      // Clicking a station that failed earlier is a deliberate retry.
      if (state.dead.includes(index)) {
        state = { ...state, dead: state.dead.filter((i) => i !== index) };
      }
      if (index === state.index && state.status === STATUS.PLAYING) return;
      loadStation(index, { autoplay: true });
    });

    fragment.append(chip);
  });

  el.stations.append(fragment);
}

// ---------------------------------------------------------------------- audio

function applyVolume() {
  el.audio.volume = state.volume;
  el.audio.muted = state.muted;
}

function safePlay(token = attempt.token) {
  desiredPlaying = true;
  const result = el.audio.play();
  if (!result || typeof result.catch !== "function") return;

  result.catch((error) => {
    if (token !== attempt.token) return; // a newer load replaced this one
    if (error?.name === "AbortError") return;
    desiredPlaying = false;

    if (error?.name === "NotAllowedError") {
      state = { ...state, status: STATUS.PAUSED };
      render();
      showToast("Press play to start the radio");
      return;
    }

    // Anything else is a real playback failure for the current attempt.
    fail(token, error?.name ?? "Playback failed");
  });
}

/**
 * Point the audio element at a station.
 *
 * `token` guards against late events from a previous station: every load gets a
 * new token, and any handler whose token is stale does nothing.
 */
function loadStation(index, { autoplay } = { autoplay: true }) {
  const channel = CHANNELS[index];
  if (!channel) return;

  state = {
    ...selectStation(state, CHANNELS, index),
    status: autoplay ? STATUS.LOADING : STATUS.IDLE,
    error: null,
  };
  attempt = { index: state.index, retries: 0, token: attempt.token + 1 };
  desiredPlaying = Boolean(autoplay);

  const token = attempt.token;
  loadStartedAt = Date.now();
  el.audio.onerror = () => fail(token, "Stream error");
  el.audio.src = channel.url;
  el.audio.load();
  applyVolume();
  render();
  persist();
  updateMediaMetadata(channel);

  if (autoplay) safePlay(token);
}

/** One retry, then declare the station dead and move on. */
function fail(token, reason = "Stream error") {
  if (token !== attempt.token) return;

  const channel = CHANNELS[attempt.index];
  if (!channel) return;

  if (attempt.retries === 0) {
    attempt.retries = 1;
    state = { ...state, status: desiredPlaying ? STATUS.LOADING : STATUS.PAUSED };
    render();
    showToast(`${channel.name} is not answering — retrying once`);

    window.setTimeout(() => {
      if (token !== attempt.token) return;
      el.audio.src = channel.url;
      el.audio.load();
      if (desiredPlaying) safePlay();
    }, RETRY_DELAY_MS);
    return;
  }

  state = markDead(state, CHANNELS, attempt.index);
  state = { ...state, status: desiredPlaying ? STATUS.LOADING : STATUS.PAUSED, error: reason };
  render();
  persist();
  showToast(`${channel.name} is offline`);

  const target = nextPlayable(CHANNELS, attempt.index, state.dead, 1);
  if (target === -1) {
    desiredPlaying = false;
    state = { ...state, status: STATUS.ERROR, error: "Every station is offline" };
    el.audio.pause();
    render();
    showToast("Every station is offline. Check back later.", 5000);
    return;
  }

  const keepPlaying = desiredPlaying;
  window.setTimeout(() => {
    if (token !== attempt.token) return;
    if (keepPlaying) loadStation(target, { autoplay: true });
    else selectAt(target);
  }, SKIP_DELAY_MS);
}

// ------------------------------------------------------------------- controls

function togglePlay() {
  const active = state.status === STATUS.PLAYING || state.status === STATUS.LOADING;

  if (active) {
    desiredPlaying = false;
    el.audio.pause();
    state = { ...state, status: STATUS.PAUSED };
    render();
    persist();
    return;
  }

  const needsLoad = attempt.index !== state.index || !el.audio.currentSrc || state.status === STATUS.ERROR;
  if (needsLoad) {
    loadStation(state.index, { autoplay: true });
    return;
  }

  state = { ...state, status: STATUS.LOADING };
  render();
  safePlay();
}

function step(direction) {
  const target = nextPlayable(CHANNELS, state.index, state.dead, direction);
  if (target === -1) {
    showToast("No playable stations left");
    return;
  }
  selectAt(target);
}

/**
 * Move to a station without necessarily loading it. Tuning while paused should
 * be silent and instant; tuning while playing should keep playing.
 */
function selectAt(index) {
  if (!desiredPlaying) {
    state = { ...selectStation(state, CHANNELS, index), status: STATUS.IDLE, error: null };
    render();
    persist();
    updateMediaMetadata(channelAt(CHANNELS, state.index));
    return;
  }
  loadStation(index, { autoplay: true });
}

function nudgeVolume(delta) {
  const next = clampToRange(state.volume + delta);
  state = { ...setVolumeState(state, next), muted: false };
  applyVolume();
  render();
  persist();
}

function clampToRange(value) {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

// --------------------------------------------------------------- media session

function updateMediaMetadata(channel) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  if (!channel) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: channel.name,
      artist: `${channel.group} · Outpost Radio`,
      album: "Outpost Radio",
      artwork: [
        {
          src: new URL("assets/sunset-bg.jpg", window.location.href).href,
          sizes: "3840x2160",
          type: "image/jpeg",
        },
      ],
    });
  } catch {
    /* MediaMetadata is unavailable or blocked (e.g. an insecure origin) */
  }
}

function wireMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const handlers = {
    play: () => {
      if (!el.audio.currentSrc || attempt.index !== state.index || state.status === STATUS.ERROR) {
        loadStation(state.index, { autoplay: true });
      } else {
        state = { ...state, status: STATUS.LOADING };
        render();
        safePlay();
      }
    },
    pause: () => {
      desiredPlaying = false;
      el.audio.pause();
      state = { ...state, status: STATUS.PAUSED };
      render();
    },
    previoustrack: () => step(-1),
    nexttrack: () => step(1),
    stop: () => {
      desiredPlaying = false;
      el.audio.pause();
      el.audio.removeAttribute("src");
      el.audio.load();
      attempt = { index: -1, retries: 0, token: attempt.token + 1 };
      state = { ...state, status: STATUS.IDLE, error: null };
      render();
    },
  };

  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action not supported in this browser */
    }
  }
}

// --------------------------------------------------------------------- events

function wireAudioEvents() {
  el.audio.addEventListener("playing", () => {
    desiredPlaying = true;
    state = { ...state, status: STATUS.PLAYING, error: null };
    render();
  });

  el.audio.addEventListener("waiting", () => {
    if (!desiredPlaying) return;
    if (state.status === STATUS.LOADING) return;
    state = { ...state, status: STATUS.LOADING };
    render();
  });

  el.audio.addEventListener("pause", () => {
    // A pause this close to a source swap is the browser tearing down the old
    // stream, not a user action.
    if (desiredPlaying && Date.now() - loadStartedAt < 800) return;
    // The system (headphones unplugged, audio focus lost) can pause us too.
    // If so, respect it instead of showing ON AIR over silence.
    desiredPlaying = false;
    if (state.status === STATUS.PLAYING || state.status === STATUS.LOADING) {
      state = { ...state, status: STATUS.PAUSED };
      render();
    }
  });

  el.audio.addEventListener("ended", () => {
    // Live streams should never end; if one does, reconnect rather than die.
    if (desiredPlaying && attempt.index >= 0) {
      loadStation(attempt.index, { autoplay: true });
    }
  });
}

function wireControls() {
  el.play.addEventListener("click", togglePlay);

  el.prev.addEventListener("click", () => step(-1));
  el.next.addEventListener("click", () => step(1));

  el.mute.addEventListener("click", () => {
    state = toggleMute(state);
    applyVolume();
    render();
    persist();
    showToast(state.muted ? "Muted" : `Volume ${formatVolume(state)}`, 1200);
  });

  el.volume.addEventListener("input", () => {
    state = setVolumeState(state, Number(el.volume.value) / 100);
    if (state.muted && state.volume > 0) state = { ...state, muted: false };
    applyVolume();
    render();
    persist();
  });

  // Mouse wheel on the volume capsule is a nice desktop touch.
  el.volume.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      nudgeVolume(event.deltaY < 0 ? 0.05 : -0.05);
    },
    { passive: false },
  );
}

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    const tag = target?.tagName;
    const typing =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
    if (typing) return;

    // A focused button already handles space/enter itself; intercepting space
    // there would fire the action twice.
    const onButton = tag === "BUTTON";

    switch (event.key) {
      case " ":
      case "Spacebar":
        if (onButton) return;
        event.preventDefault();
        togglePlay();
        break;
      case "k":
      case "K":
        if (onButton) return;
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        event.preventDefault();
        step(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        step(1);
        break;
      case "m":
      case "M":
        event.preventDefault();
        state = toggleMute(state);
        applyVolume();
        render();
        persist();
        break;
      default:
        break;
    }
  });
}

function wireVisibility() {
  const sync = () => document.body.classList.toggle("is-hidden", document.hidden);
  document.addEventListener("visibilitychange", sync);
  sync();
}

// ----------------------------------------------------------------------- init

function init() {
  if (!CHANNELS.length) {
    showToast("No stations configured", 5000);
    return;
  }

  buildStationList();
  wireAudioEvents();
  wireControls();
  wireKeyboard();
  wireMediaSession();
  wireVisibility();

  applyVolume();
  render();
  updateMediaMetadata(channelAt(CHANNELS, state.index));

  // If the saved station has since been removed, fall back to the first one.
  if (!channelAt(CHANNELS, state.index)) {
    state = { ...state, index: 0 };
    render();
  }
}

init();
