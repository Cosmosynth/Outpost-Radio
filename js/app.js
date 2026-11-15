/**
 * DOM + audio layer.
 *
 * Everything that can be reasoned about without a browser lives in
 * `player-core.js`; this file only translates state into the DOM and translates
 * audio events back into state. Keep it boring — the reducer holds the logic.
 */
import { CHANNELS, GROUPS } from "./channels.js";
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
  tune,
} from "./player-core.js";

const STORAGE_KEY = "outpost-radio:v1";
const RETRY_DELAY_MS = 900;
const SKIP_DELAY_MS = 550;
const STABLE_PLAY_MS = 15_000;

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
  stationsCount: document.getElementById("stations-count"),
  stationName: document.getElementById("station-name"),
  stationGroup: document.getElementById("station-group"),
  stationNumber: document.getElementById("station-number"),
  stationTotal: document.getElementById("station-total"),
  status: document.getElementById("status"),
  needle: document.getElementById("dial-needle"),
  tunerScale: document.getElementById("tuner-scale"),
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

/** True between assigning a new source and the first `playing` event. */
let swapping = false;

/** When the current continuous playback started; used to restore the retry budget. */
let playingSince = 0;

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

const pad2 = (value) => String(value).padStart(2, "0");

/** Where station `index` sits on the tuner rail, matching the CSS inset. */
function scalePosition(index, count = CHANNELS.length || 1) {
  return 4 + ((index + 0.5) / count) * 92;
}

/** Scroll only the station rail — never the page — to keep the active row in view. */
function keepActiveVisible(row) {
  const list = el.stations;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  const viewTop = list.scrollTop;
  const viewBottom = viewTop + list.clientHeight;

  if (top < viewTop) list.scrollTop = Math.max(0, top - 8);
  else if (bottom > viewBottom) list.scrollTop = bottom - list.clientHeight + 8;
}

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
  if (el.stationNumber.textContent !== pad2(state.index + 1)) {
    el.stationNumber.textContent = pad2(state.index + 1);
  }
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

  const percent = Math.round(state.volume * 100);
  el.volume.value = String(percent);
  // The native range paints a bare thumb on Chrome; the filled rail comes from
  // this custom property, which the track gradient reads.
  el.volume.style.setProperty("--fill", `${percent}%`);
  el.volume.classList.toggle("is-muted", state.muted);
  el.volumeValue.textContent = state.muted ? "MUTE" : formatVolume(state);

  el.needle.style.left = `${scalePosition(state.index)}%`;

  const previousIndex = lastRenderedIndex;
  lastRenderedIndex = state.index;
  // Never scroll on first paint — the rail has its own scroll position and the
  // user has not chosen anything yet.
  const shouldScroll = previousIndex !== -1 && previousIndex !== state.index;

  for (const row of el.stations.children) {
    if (!row.classList.contains("station")) continue;
    const index = Number(row.dataset.index);
    const active = index === state.index;
    row.classList.toggle("is-active", active);
    row.classList.toggle("is-dead", state.dead.includes(index));
    if (active) {
      row.setAttribute("aria-current", "true");
      // Keep the dialled station visible in the rail, without moving the page.
      if (shouldScroll) keepActiveVisible(row);
    } else {
      row.removeAttribute("aria-current");
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
  const total = CHANNELS.length;

  if (el.stationsCount) el.stationsCount.textContent = `${total} live`;
  if (el.stationTotal) el.stationTotal.textContent = pad2(total);

  GROUPS.forEach((groupName) => {
    const members = CHANNELS.map((channel, index) => ({ channel, index }))
      .filter(({ channel }) => channel.group === groupName);
    if (!members.length) return;

    const heading = document.createElement("h3");
    heading.className = "stations__group";
    heading.textContent = groupName;
    fragment.append(heading);

    for (const { channel, index } of members) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "station";
      row.dataset.index = String(index);
      row.dataset.group = channel.group;
      row.title = `${channel.group} · ${channel.name}`;

      const num = document.createElement("span");
      num.className = "station__num";
      num.textContent = pad2(index + 1);
      num.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "station__name";
      label.textContent = channel.name;

      const signal = document.createElement("span");
      signal.className = "station__signal";
      signal.setAttribute("aria-hidden", "true");
      for (let bar = 0; bar < 3; bar += 1) signal.append(document.createElement("i"));

      row.append(num, label, signal);
      row.addEventListener("click", () => {
        // Clicking a station that failed earlier is a deliberate retry.
        if (state.dead.includes(index)) {
          state = { ...state, dead: state.dead.filter((i) => i !== index) };
        }
        if (index === state.index && state.status === STATUS.PLAYING) return;
        loadStation(index, { autoplay: true });
      });

      fragment.append(row);
    }
  });

  el.stations.append(fragment);
}

/**
 * Draw the tuner scale once. Ticks align with the same `scalePosition` math the
 * needle uses, so the pointer lands on the station it names.
 */
function buildTuner() {
  if (!el.tunerScale) return;
  const total = CHANNELS.length || 1;
  const fragment = document.createDocumentFragment();

  CHANNELS.forEach((channel, index) => {
    const major = index % 4 === 0 || index === total - 1;
    const tick = document.createElement("span");
    tick.className = major ? "tuner__tick is-major" : "tuner__tick";
    tick.style.left = `${scalePosition(index, total)}%`;
    fragment.append(tick);

    if (!major) return;
    const label = document.createElement("span");
    label.className = "tuner__label";
    label.style.left = `${scalePosition(index, total)}%`;
    label.textContent = pad2(index + 1);
    label.title = channel.name;
    fragment.append(label);
  });

  el.tunerScale.append(fragment);
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
  swapping = true;
  playingSince = 0;

  const token = attempt.token;
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

  // A stream that played for a while earns its retry budget back; otherwise a
  // single hiccup an hour into a session would condemn it permanently.
  if (playingSince > 0 && Date.now() - playingSince > STABLE_PLAY_MS) {
    attempt.retries = 0;
  }
  playingSince = 0;
  swapping = false;

  if (attempt.retries === 0) {
    attempt.retries = 1;
    state = { ...state, status: desiredPlaying ? STATUS.LOADING : STATUS.PAUSED };
    render();
    showToast(`${channel.name} is not answering — retrying once`);

    window.setTimeout(() => {
      if (token !== attempt.token) return;
      swapping = true;
      playingSince = 0;
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
  // We are about to swap sources; ignore any teardown pause from the failed one.
  if (keepPlaying) swapping = true;
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

  const needsLoad =
    attempt.index !== state.index ||
    !el.audio.currentSrc ||
    state.status === STATUS.ERROR ||
    state.dead.includes(state.index);
  if (needsLoad) {
    loadStation(state.index, { autoplay: true });
    return;
  }

  state = { ...state, status: STATUS.LOADING };
  render();
  safePlay();
}

function step(direction) {
  const next = tune(state, CHANNELS, direction);
  if (next.status === STATUS.ERROR) {
    showToast("No playable stations left");
    return;
  }
  selectAt(next.index);
}

/**
 * Move to a station without necessarily loading it. Tuning while paused should
 * be silent and instant; tuning while playing should keep playing.
 */
function selectAt(index) {
  if (!desiredPlaying) {
    // Invalidate any pending retry/skip timer: the user just picked a station,
    // and a timer scheduled 500 ms ago must not tune away from it.
    attempt = { ...attempt, token: attempt.token + 1 };
    swapping = false;
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
          src: new URL("assets/lakeside-sunset.webp", window.location.href).href,
          sizes: "2560x1440",
          type: "image/webp",
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
    swapping = false;
    playingSince = Date.now();
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
    // While a new source is being swapped in, the browser fires pause for the
    // old stream. That is teardown, not the user, and `swapping` is the reliable
    // signal for it (a timer would misfire on slow loads).
    if (desiredPlaying && swapping) return;
    // The system (headphones unplugged, audio focus lost) can pause us too.
    // If so, respect it instead of showing ON AIR over silence.
    desiredPlaying = false;
    if (state.status === STATUS.PLAYING || state.status === STATUS.LOADING) {
      state = { ...state, status: STATUS.PAUSED };
      render();
    }
  });

  el.audio.addEventListener("ended", () => {
    // Live streams never end. If one does (or a finite stream sneaks in), treat
    // it as a failure so the retry/skip budget applies instead of looping.
    if (desiredPlaying) fail(attempt.token, "Stream ended");
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

    // Holding a key should not machine-gun station loads or mute flips.
    if (event.repeat) return;

    // A focused button already handles space/enter itself; intercepting space
    // there would fire the action twice. Other shortcuts stay live.
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
  buildTuner();
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
