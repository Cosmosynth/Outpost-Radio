/**
 * DOM + audio layer.
 *
 * Everything that can be reasoned about without a browser lives in
 * `player-core.js`; this file translates state into the DOM and audio events
 * back into state. Keep it boring — the reducer holds the logic.
 */
import { CHANNELS, GROUPS, indexOfChannel } from "./channels.js";
import {
  STATUS,
  createState,
  selectStation,
  markDead,
  setVolume as setVolumeState,
  toggleMute,
  toggleFavorite,
  pushRecent,
  filterChannels,
  channelIndexById,
  channelAt,
  formatVolume,
  statusLabel,
  nextPlayable,
  tune,
  wrapIndex,
} from "./player-core.js";

const STORAGE_KEY = "outpost-radio:v2";
const LEGACY_KEY = "outpost-radio:v1";
const RETRY_DELAY_MS = 900;
const SKIP_DELAY_MS = 550;
const STABLE_PLAY_MS = 15_000;
const FADE_IN_MS = 380;
const SLEEP_FADE_MS = 8_000;

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
  drawerCount: document.getElementById("drawer-count"),

  stationName: document.getElementById("station-name"),
  stationGroup: document.getElementById("station-group"),
  stationMeta: document.getElementById("station-meta"),
  stationNumber: document.getElementById("station-number"),
  stationTotal: document.getElementById("station-total"),
  status: document.getElementById("status"),

  clock: document.getElementById("clock"),
  airLabel: document.getElementById("air-label"),
  airTimer: document.getElementById("air-timer"),

  needle: document.getElementById("dial-needle"),
  tuner: document.getElementById("tuner"),
  tunerScale: document.getElementById("tuner-scale"),
  tunerBands: document.getElementById("tuner-bands"),

  toast: document.getElementById("toast"),

  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  iconVolume: document.getElementById("icon-volume"),
  iconMuted: document.getElementById("icon-muted"),

  drawer: document.getElementById("drawer"),
  drawerScrim: document.getElementById("drawer-scrim"),
  closeStations: document.getElementById("close-stations"),
  stationSearch: document.getElementById("station-search"),
  groupFilters: document.getElementById("group-filters"),
  openStations: document.getElementById("open-stations"),

  settings: document.getElementById("settings"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  toggleSound: document.getElementById("toggle-sound"),
  toggleCompact: document.getElementById("toggle-compact"),
  toggleFaceplate: document.getElementById("toggle-faceplate"),
  toggleCinema: document.getElementById("toggle-cinema"),
  sleepStatus: document.getElementById("sleep-status"),
  sleepChip: document.getElementById("sleep-chip"),
  sleepChipText: document.getElementById("sleep-chip-text"),
  sleepButtons: ["0", "15", "30", "60"]
    .map((minutes) => document.getElementById(`sleep-${minutes}`))
    .filter(Boolean),

  help: document.getElementById("help"),
  openHelp: document.getElementById("open-help"),
  helpClose: document.getElementById("help-close"),
  helpScrim: document.getElementById("help-scrim"),
};

// -------------------------------------------------------------------- storage

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const saved = readSaved();

function storedId(value) {
  return typeof value === "string" ? value : "";
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => channelIndexById(CHANNELS, id) >= 0))];
}

/** Snapshot the parts of the session worth restoring on the next visit. */
function persist() {
  try {
    const channel = channelAt(CHANNELS, state.index);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: channel?.id ?? "",
        index: state.index,
        volume: Math.round(state.volume * 100) / 100,
        muted: state.muted,
        favorites: state.favorites,
        recent: state.recent,
        density: document.body.dataset.density === "compact" ? "compact" : "full",
        layout: document.body.dataset.layout === "faceplate" ? "faceplate" : "console",
        cinema: document.body.classList.contains("is-cinema"),
        sound: soundOn,
      }),
    );
  } catch {
    /* private mode or a blocked storage API — persistence is a nicety */
  }
}

// ---------------------------------------------------------------------- state

const params = new URLSearchParams(window.location.search);
const idFromUrl = params.get("s");
const urlIndex = channelIndexById(CHANNELS, idFromUrl);
const savedIdIndex = channelIndexById(CHANNELS, storedId(saved.id));
const savedIndex = Number.isInteger(saved.index) ? saved.index : 0;

let startIndex = urlIndex >= 0 ? urlIndex : savedIdIndex >= 0 ? savedIdIndex : savedIndex;

let state = createState({
  channels: CHANNELS,
  index: startIndex,
  volume: saved.volume,
  muted: saved.muted,
  favorites: cleanIds(saved.favorites),
  recent: cleanIds(saved.recent),
});

/** The user's intent, which is not the same as `audio.paused` during a load. */
let desiredPlaying = false;

/** Which station is actually in the <audio> element, and how the load is going. */
let attempt = { index: -1, retries: 0, token: 0 };

/** True between assigning a new source and the first `playing` event. */
let swapping = false;

/** When the current continuous playback started; used to restore the retry budget. */
let playingSince = 0;

/** True while the new station is fading back in. */
let fadingIn = false;

/** Station being previewed by dragging or scrolling the tuner. */
let previewIndex = null;

/** Which station the list was last scrolled to. */
let lastRenderedIndex = -1;

const ui = {
  filter: "All",
  query: "",
  drawer: false,
  settings: false,
  help: false,
};

const savedDensity = saved.density === "compact" ? "compact" : "full";
const savedLayout = saved.layout === "faceplate" ? "faceplate" : "console";
let soundOn = saved.sound !== false;

document.body.dataset.density = savedDensity;
document.body.dataset.layout = savedLayout;
if (saved.cinema === true) document.body.classList.add("is-cinema");

// ---------------------------------------------------------------------- utils

const pad2 = (value) => String(value).padStart(2, "0");

const raf =
  typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (fn) => window.setTimeout(() => fn(Date.now()), 16);

/** Where station `index` sits on the tuner rail, matching the CSS inset. */
function scalePosition(index, count = CHANNELS.length || 1) {
  return 4 + ((index + 0.5) / count) * 92;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

// --------------------------------------------------------------------- render

function keepActiveVisible(row) {
  if (!ui.drawer) return;
  const list = el.stations;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  const viewTop = list.scrollTop;
  const viewBottom = viewTop + list.clientHeight;

  if (top < viewTop) list.scrollTop = Math.max(0, top - 8);
  else if (bottom > viewBottom) list.scrollTop = bottom - list.clientHeight + 8;
}

function render() {
  const index = previewIndex ?? state.index;
  const channel = channelAt(CHANNELS, index);
  const showPause = state.status === STATUS.PLAYING || state.status === STATUS.LOADING;

  const name = channel?.name ?? "No station";
  const group = channel ? channel.group.toUpperCase() : "—";
  const meta = channel ? `${channel.place} · ${channel.note}`.toUpperCase() : "—";
  const statusText = state.status === STATUS.ERROR ? "OFFLINE" : statusLabel(state);

  if (el.stationName.textContent !== name) el.stationName.textContent = name;
  if (el.stationGroup.textContent !== group) el.stationGroup.textContent = group;
  if (el.stationMeta.textContent !== meta) el.stationMeta.textContent = meta;
  if (el.stationNumber.textContent !== pad2(index + 1)) {
    el.stationNumber.textContent = pad2(index + 1);
  }
  if (el.status.textContent !== statusText) el.status.textContent = statusText;
  el.status.dataset.status = state.status;

  document.body.dataset.state = state.status;

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
  el.volume.style.setProperty("--fill", `${percent}%`);
  el.volume.classList.toggle("is-muted", state.muted);
  el.volumeValue.textContent = state.muted ? "MUTE" : formatVolume(state);

  el.needle.style.left = `${scalePosition(index)}%`;

  el.tuner.setAttribute("aria-valuenow", String(index + 1));
  el.tuner.setAttribute("aria-valuemax", String(CHANNELS.length));
  el.tuner.setAttribute("aria-valuetext", channel ? `Station ${index + 1}: ${channel.name}` : "No station");

  if (el.airLabel) el.airLabel.textContent = statusText;

  const previousIndex = lastRenderedIndex;
  lastRenderedIndex = index;
  const shouldScroll = !ui.drawer || previewIndex !== null ? false : previousIndex !== -1 && previousIndex !== index;

  for (const row of el.stations.children) {
    if (!row.classList?.contains("station-row")) continue;
    const rowIndex = Number(row.dataset.index);
    const active = rowIndex === index;
    row.classList.toggle("is-active", active);
    row.classList.toggle("is-dead", state.dead.includes(rowIndex));
    if (active) {
      row.setAttribute("aria-current", "true");
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

// ---------------------------------------------------------------------- tuner

function buildTuner() {
  if (!el.tunerScale || !el.tunerBands) return;
  const total = CHANNELS.length || 1;
  const step = 92 / total;
  const scale = document.createDocumentFragment();
  const bands = document.createDocumentFragment();

  for (const group of GROUPS) {
    const members = CHANNELS.map((channel, index) => ({ channel, index }))
      .filter(({ channel }) => channel.group === group);
    if (!members.length) continue;
    const first = members[0].index;
    const last = members[members.length - 1].index;

    const band = document.createElement("span");
    band.className = "tuner__band";
    band.dataset.group = group;
    band.style.left = `${4 + first * step}%`;
    band.style.width = `${(last - first + 1) * step}%`;
    bands.append(band);
  }

  CHANNELS.forEach((channel, index) => {
    const major = index % 5 === 0 || index === total - 1;
    const tick = document.createElement("span");
    tick.className = major ? "tuner__tick is-major" : "tuner__tick";
    tick.style.left = `${scalePosition(index, total)}%`;
    scale.append(tick);

    if (!major) return;
    const label = document.createElement("span");
    label.className = "tuner__label";
    label.style.left = `${scalePosition(index, total)}%`;
    label.textContent = pad2(index + 1);
    label.title = channel.name;
    scale.append(label);
  });

  el.tunerScale.replaceChildren(scale);
  el.tunerBands.replaceChildren(bands);
}

function tunerIndexAt(clientX) {
  const rect = el.tuner.getBoundingClientRect();
  if (!rect.width) return state.index;
  const percent = ((clientX - rect.left) / rect.width) * 100;
  const step = 92 / (CHANNELS.length || 1);
  const raw = Math.round((percent - 4) / step - 0.5);
  return Math.min(CHANNELS.length - 1, Math.max(0, raw));
}

function commitPreview() {
  const index = previewIndex;
  previewIndex = null;
  if (index !== null && index !== state.index) selectAt(index);
  else render();
}

function wireTuner() {
  let dragId = null;
  let wheelTimer = 0;
  let wheelTarget = null;

  el.tuner.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragId = event.pointerId;
    el.tuner.setPointerCapture?.(event.pointerId);
    el.tuner.classList.add("is-scrubbing");
    previewIndex = tunerIndexAt(event.clientX);
    render();
    event.preventDefault();
  });

  el.tuner.addEventListener("pointermove", (event) => {
    if (dragId === null || event.pointerId !== dragId) return;
    const index = tunerIndexAt(event.clientX);
    if (index !== previewIndex) {
      previewIndex = index;
      render();
    }
  });

  for (const type of ["pointerup", "pointercancel"]) {
    el.tuner.addEventListener(type, (event) => {
      if (dragId === null || event.pointerId !== dragId) return;
      dragId = null;
      el.tuner.classList.remove("is-scrubbing");
      commitPreview();
    });
  }

  el.tuner.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;
      const base = wheelTarget ?? previewIndex ?? state.index;
      wheelTarget = wrapIndex(base + direction, CHANNELS.length);
      previewIndex = wheelTarget;
      render();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelTarget = null;
        commitPreview();
      }, 220);
    },
    { passive: false },
  );
}

// ------------------------------------------------------------------- stations

function groupHeading(label) {
  const heading = document.createElement("h3");
  heading.className = "drawer__group";
  heading.textContent = label;
  return heading;
}

function signalBars() {
  const signal = document.createElement("span");
  signal.className = "station__signal";
  signal.setAttribute("aria-hidden", "true");
  for (let bar = 0; bar < 3; bar += 1) signal.append(document.createElement("i"));
  return signal;
}

function buildStationRow(channel, index, position) {
  const row = document.createElement("div");
  row.className = "station-row";
  row.dataset.index = String(index);
  row.dataset.group = channel.group;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "station";
  button.dataset.index = String(index);
  button.dataset.id = channel.id;
  button.title = `${channel.name} — ${channel.place}`;

  const number = document.createElement("span");
  number.className = "station__num";
  number.textContent = pad2(position + 1);
  number.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "station__body";

  const name = document.createElement("span");
  name.className = "station__name";
  name.textContent = channel.name;

  const sub = document.createElement("span");
  sub.className = "station__sub";
  sub.textContent = `${channel.place} · ${channel.note}`;

  body.append(name, sub);
  button.append(number, body, signalBars());

  button.addEventListener("click", () => {
    if (state.dead.includes(index)) {
      state = { ...state, dead: state.dead.filter((entry) => entry !== index) };
    }
    closeDrawer();
    selectAt(index, { play: true });
  });

  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "station__fav";
  favorite.dataset.id = channel.id;
  const isFavorite = state.favorites.includes(channel.id);
  favorite.textContent = isFavorite ? "★" : "☆";
  favorite.setAttribute("aria-pressed", String(isFavorite));
  favorite.setAttribute("aria-label", `${isFavorite ? "Remove" : "Add"} ${channel.name} ${isFavorite ? "from" : "to"} favorites`);
  favorite.addEventListener("click", (event) => {
    event.stopPropagation();
    favoriteById(channel.id);
  });

  row.append(button, favorite);
  return row;
}

function renderStations() {
  const favoritesOnly = ui.filter === "Favorites";
  const group = favoritesOnly || ui.filter === "All" ? "All" : ui.filter;
  const matches = filterChannels(CHANNELS, {
    query: ui.query,
    group,
    favoritesOnly,
    favorites: state.favorites,
  });

  const fragment = document.createDocumentFragment();
  const structured = !ui.query;

  if (structured && !favoritesOnly && ui.filter === "All" && state.recent.length) {
    const recent = state.recent
      .map((id) => channelIndexById(CHANNELS, id))
      .filter((index) => index >= 0 && matches.includes(CHANNELS[index]))
      .slice(0, 4);

    if (recent.length) {
      fragment.append(groupHeading("Recent"));
      for (const index of recent) {
        fragment.append(buildStationRow(CHANNELS[index], index, index));
      }
    }
  }

  for (const groupName of GROUPS) {
    const members = matches
      .map((channel) => ({ channel, index: CHANNELS.indexOf(channel) }))
      .filter(({ channel }) => channel.group === groupName);
    if (!members.length) continue;

    if (structured) fragment.append(groupHeading(groupName));
    for (const { channel, index } of members) {
      fragment.append(buildStationRow(channel, index, index));
    }
  }

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "drawer__empty";
    empty.textContent = ui.query
      ? `No stations match “${ui.query}”.`
      : "No favorites yet — tap the star beside a station.";
    fragment.append(empty);
  }

  el.stations.replaceChildren(fragment);
  if (el.drawerCount) el.drawerCount.textContent = String(matches.length);
  if (el.stationsCount) el.stationsCount.textContent = String(CHANNELS.length);
  render();
}

function buildFilters() {
  if (!el.groupFilters) return;
  const filters = ["All", "Favorites", ...GROUPS];
  const fragment = document.createDocumentFragment();

  for (const name of filters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter";
    button.dataset.filter = name;
    button.textContent = name;
    button.addEventListener("click", () => {
      ui.filter = name;
      paintFilters();
      renderStations();
    });
    fragment.append(button);
  }

  el.groupFilters.replaceChildren(fragment);
  paintFilters();
}

function paintFilters() {
  for (const button of el.groupFilters.children) {
    button.classList.toggle("is-active", button.dataset.filter === ui.filter);
  }
}

function favoriteById(id) {
  const wasFavorite = state.favorites.includes(id);
  state = toggleFavorite(state, id);
  persist();

  if (ui.filter === "Favorites") {
    renderStations();
  } else {
    for (const row of el.stations.children) {
      if (!row.classList?.contains("station-row")) continue;
      const button = row.children[1];
      if (!button || button.dataset.id !== id) continue;
      const on = state.favorites.includes(id);
      button.textContent = on ? "★" : "☆";
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute(
        "aria-label",
        `${on ? "Remove" : "Add"} ${channelAt(CHANNELS, channelIndexById(CHANNELS, id))?.name ?? "station"} ${on ? "from" : "to"} favorites`,
      );
    }
  }

  const channel = channelAt(CHANNELS, channelIndexById(CHANNELS, id));
  showToast(wasFavorite ? `Removed ${channel?.name ?? "station"}` : `Saved ${channel?.name ?? "station"}`, 1500);
  render();
}

// ------------------------------------------------------------------- drawer

function openDrawer({ focusSearch = false } = {}) {
  ui.drawer = true;
  el.drawer.classList.add("is-open");
  el.drawer.setAttribute("aria-hidden", "false");
  el.openStations.setAttribute("aria-expanded", "true");
  renderStations();
  // Only steal focus when the user asked for search with `/`; on a phone an
  // automatic keyboard would cover most of the sheet.
  if (focusSearch) el.stationSearch.focus?.();
}

function closeDrawer() {
  ui.drawer = false;
  el.drawer.classList.remove("is-open");
  el.drawer.setAttribute("aria-hidden", "true");
  el.openStations.setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------- settings

function openSettings() {
  ui.settings = true;
  el.settings.hidden = false;
  el.settings.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  ui.settings = false;
  el.settings.hidden = true;
  el.settings.setAttribute("aria-hidden", "true");
}

function openHelp() {
  ui.help = true;
  el.help.hidden = false;
  el.helpClose.focus?.();
}

function closeHelp() {
  ui.help = false;
  el.help.hidden = true;
}

function syncToggle(button, on) {
  button.setAttribute("aria-checked", String(on));
}

// ---------------------------------------------------------------------- toast

let toastTimer = 0;

function showToast(message, ms = 3000) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), ms);
}

// ---------------------------------------------------------------------- audio

function applyVolume() {
  el.audio.volume = state.volume;
  el.audio.muted = state.muted;
}

/** Ramp the real audio volume, used for fade-in and the sleep timer. */
function rampAudio(target, duration, done) {
  const from = el.audio.volume;
  const start = Date.now();
  const clampTarget = Math.min(1, Math.max(0, target));

  const step = () => {
    const progress = duration <= 0 ? 1 : Math.min(1, (Date.now() - start) / duration);
    el.audio.volume = from + (clampTarget - from) * progress;
    if (progress < 1) raf(step);
    else if (done) done();
  };

  step();
}

function clickSound() {
  if (!soundOn) return;
  const Context = window.AudioContext ?? window.webkitAudioContext;
  if (!Context) return;

  try {
    audioContext ??= new Context();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.045);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch {
    /* audio unavailable — the click is a nicety */
  }
}

let audioContext = null;

function safePlay(token = attempt.token) {
  desiredPlaying = true;
  const result = el.audio.play();
  if (!result || typeof result.catch !== "function") return;

  result.catch((error) => {
    if (token !== attempt.token) return;
    if (error?.name === "AbortError") return;
    desiredPlaying = false;

    if (error?.name === "NotAllowedError") {
      state = { ...state, status: STATUS.PAUSED };
      render();
      showToast("Press play to start the radio");
      return;
    }

    fail(token, error?.name ?? "Playback failed");
  });
}

/**
 * Point the audio element at a station.
 *
 * `token` guards against late events from a previous station: every load gets a
 * new token, and any handler whose token is stale does nothing.
 */
function loadStation(index, { autoplay = true, fade = false } = {}) {
  const channel = CHANNELS[index];
  if (!channel) return;

  state = pushRecent(selectStation(state, CHANNELS, index), channel.id);
  state = { ...state, status: autoplay ? STATUS.LOADING : STATUS.IDLE, error: null };

  attempt = { index, retries: 0, token: attempt.token + 1 };
  desiredPlaying = Boolean(autoplay);
  swapping = true;
  playingSince = 0;

  const token = attempt.token;
  el.audio.onerror = () => fail(token, "Stream error");
  el.audio.src = channel.url;
  el.audio.load();

  if (fade) {
    el.audio.volume = 0;
    fadingIn = true;
  } else {
    fadingIn = false;
    applyVolume();
  }

  render();
  persist();
  updateMediaMetadata(channel);
  syncUrl(channel);

  if (autoplay) safePlay(token);
}

/** One retry, then declare the station dead and move on. */
function fail(token, reason = "Stream error") {
  if (token !== attempt.token) return;

  const channel = CHANNELS[attempt.index];
  if (!channel) return;

  fadingIn = false;
  el.audio.volume = state.volume;

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
  if (keepPlaying) swapping = true;
  window.setTimeout(() => {
    if (token !== attempt.token) return;
    if (keepPlaying) loadStation(target, { autoplay: true, fade: true });
    else selectAt(target, { silent: true });
  }, SKIP_DELAY_MS);
}

// ------------------------------------------------------------------- controls

function togglePlay() {
  const active = state.status === STATUS.PLAYING || state.status === STATUS.LOADING;

  if (active) {
    desiredPlaying = false;
    el.audio.pause();
    state = { ...state, status: STATUS.PAUSED };
    playingSince = 0;
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
    loadStation(state.index, { autoplay: true, fade: true });
    return;
  }

  state = { ...state, status: STATUS.LOADING };
  render();
  clickSound();
  safePlay();
}

function step(direction) {
  const next = tune(state, CHANNELS, direction);
  if (next.status === STATUS.ERROR) {
    showToast("No playable stations left");
    return;
  }
  selectAt(next.index, { silent: true });
}

/**
 * Move to a station. Tuning while paused only moves the selection; asking to
 * play loads the stream immediately.
 */
function selectAt(index, { play = false, silent = false } = {}) {
  const channel = channelAt(CHANNELS, index);
  if (!channel) return;

  if (!silent) clickSound();

  if (!play && !desiredPlaying) {
    attempt = { ...attempt, token: attempt.token + 1 };
    swapping = false;
    state = pushRecent(selectStation(state, CHANNELS, index), channel.id);
    state = { ...state, status: STATUS.IDLE };
    render();
    persist();
    updateMediaMetadata(channel);
    syncUrl(channel);
    return;
  }

  loadStation(index, { autoplay: true, fade: desiredPlaying });
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

function jumpPreset(number) {
  const id = state.favorites[number];
  const index = channelIndexById(CHANNELS, id);
  if (index < 0) {
    showToast(`No favorite in slot ${number + 1}`, 1600);
    return;
  }
  selectAt(index, { play: true });
}

// ------------------------------------------------------------------- sleep

const sleep = { deadline: 0, interval: 0, timeout: 0, active: false, minutes: 0 };

function startSleep(minutes) {
  cancelSleep();

  if (!minutes) {
    showToast("Sleep timer off", 1400);
    return;
  }

  sleep.active = true;
  sleep.minutes = minutes;
  sleep.deadline = Date.now() + minutes * 60_000;
  sleep.interval = window.setInterval(paintSleep, 1000);
  sleep.timeout = window.setTimeout(endSleep, minutes * 60_000);
  paintSleep();
  showToast(`Sleep timer: ${minutes} minutes`, 1800);
}

function endSleep() {
  sleep.active = false;
  window.clearInterval(sleep.interval);
  sleep.interval = 0;
  sleep.timeout = 0;
  showToast("Sleep timer — fading out");
  rampAudio(0, SLEEP_FADE_MS, () => {
    desiredPlaying = false;
    el.audio.pause();
    state = { ...state, status: STATUS.PAUSED };
    el.audio.volume = state.volume;
    sleep.minutes = 0;
    sleep.deadline = 0;
    paintSleep();
    render();
    persist();
    showToast("Good night", 2200);
  });
}

function cancelSleep() {
  window.clearInterval(sleep.interval);
  window.clearTimeout(sleep.timeout);
  sleep.interval = 0;
  sleep.timeout = 0;
  sleep.deadline = 0;
  sleep.active = false;
  sleep.minutes = 0;
  paintSleep();
}

function paintSleep() {
  const remaining = sleep.active ? Math.max(0, sleep.deadline - Date.now()) : 0;
  const label = sleep.active ? formatDuration(remaining) : "Off";

  if (el.sleepStatus) el.sleepStatus.textContent = label;
  if (el.sleepChip) el.sleepChip.hidden = !sleep.active;
  if (el.sleepChipText) el.sleepChipText.textContent = `SLEEP ${label}`;

  for (const button of el.sleepButtons) {
    const minutes = Number(button.dataset.sleep);
    const active = sleep.active ? minutes === sleep.minutes : minutes === 0;
    button.classList.toggle("is-active", active);
  }
}

// --------------------------------------------------------------------- clock

function paintClock() {
  const now = new Date();
  if (el.clock) el.clock.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  if (el.airTimer) {
    const elapsed = state.status === STATUS.PLAYING && playingSince > 0 ? Date.now() - playingSince : 0;
    el.airTimer.textContent = formatDuration(elapsed);
  }

  if (sleep.active) paintSleep();
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
    /* MediaMetadata is unavailable or blocked */
  }
}

function wireMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const handlers = {
    play: () => {
      if (!el.audio.currentSrc || attempt.index !== state.index || state.status === STATUS.ERROR) {
        loadStation(state.index, { autoplay: true, fade: true });
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
      playingSince = 0;
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

// -------------------------------------------------------------------- events

function wireAudioEvents() {
  el.audio.addEventListener("playing", () => {
    desiredPlaying = true;
    swapping = false;
    playingSince = Date.now();
    state = { ...state, status: STATUS.PLAYING, error: null };
    render();

    if (fadingIn) {
      fadingIn = false;
      el.audio.volume = 0;
      rampAudio(state.volume, FADE_IN_MS);
    }
  });

  el.audio.addEventListener("waiting", () => {
    if (!desiredPlaying) return;
    if (state.status === STATUS.LOADING) return;
    state = { ...state, status: STATUS.LOADING };
    render();
  });

  el.audio.addEventListener("pause", () => {
    if (desiredPlaying && swapping) return;
    desiredPlaying = false;
    playingSince = 0;
    if (state.status === STATUS.PLAYING || state.status === STATUS.LOADING) {
      state = { ...state, status: STATUS.PAUSED };
      render();
    }
  });

  el.audio.addEventListener("ended", () => {
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

  el.volume.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      nudgeVolume(event.deltaY < 0 ? 0.05 : -0.05);
    },
    { passive: false },
  );

  el.openStations.addEventListener("click", () => {
    if (ui.drawer) closeDrawer();
    else openDrawer();
  });
  el.closeStations.addEventListener("click", closeDrawer);
  el.drawerScrim.addEventListener("click", closeDrawer);

  el.stationSearch.addEventListener("input", () => {
    ui.query = el.stationSearch.value;
    renderStations();
  });

  el.openSettings.addEventListener("click", () => {
    if (ui.settings) closeSettings();
    else openSettings();
  });
  el.closeSettings.addEventListener("click", closeSettings);

  el.openHelp.addEventListener("click", openHelp);
  el.helpClose.addEventListener("click", closeHelp);
  el.helpScrim.addEventListener("click", closeHelp);

  el.toggleSound.addEventListener("click", () => {
    soundOn = !soundOn;
    syncToggle(el.toggleSound, soundOn);
    persist();
    if (soundOn) clickSound();
  });

  el.toggleCompact.addEventListener("click", () => {
    const compact = document.body.dataset.density !== "compact";
    document.body.dataset.density = compact ? "compact" : "full";
    syncToggle(el.toggleCompact, compact);
    persist();
  });

  el.toggleFaceplate.addEventListener("click", () => {
    const faceplate = document.body.dataset.layout !== "faceplate";
    document.body.dataset.layout = faceplate ? "faceplate" : "console";
    syncToggle(el.toggleFaceplate, faceplate);
    persist();
  });

  el.toggleCinema.addEventListener("click", () => {
    const cinema = !document.body.classList.contains("is-cinema");
    document.body.classList.toggle("is-cinema", cinema);
    syncToggle(el.toggleCinema, cinema);
    persist();
  });

  for (const button of el.sleepButtons) {
    button.addEventListener("click", () => {
      startSleep(Number(button.dataset.sleep));
      paintSleep();
    });
  }

  if (el.sleepChip) {
    el.sleepChip.addEventListener("click", () => {
      cancelSleep();
      showToast("Sleep timer off", 1400);
    });
  }
}

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    const tag = target?.tagName;
    const typing =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;

    if (event.key === "Escape") {
      if (ui.help) closeHelp();
      else if (ui.settings) closeSettings();
      else if (ui.drawer) closeDrawer();
      else if (typing) target.blur?.();
      return;
    }

    // Let the search field keep every printable key, including space.
    if (typing) return;

    if (event.defaultPrevented) return;
    if (event.repeat) return;

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
      case "f":
      case "F": {
        const channel = channelAt(CHANNELS, state.index);
        if (channel) favoriteById(channel.id);
        break;
      }
      case "s":
      case "S":
        event.preventDefault();
        if (ui.drawer) closeDrawer();
        else openDrawer();
        break;
      case "/":
        event.preventDefault();
        openDrawer({ focusSearch: true });
        break;
      case "?":
        event.preventDefault();
        if (ui.help) closeHelp();
        else openHelp();
        break;
      case "c":
      case "C": {
        const cinema = !document.body.classList.contains("is-cinema");
        document.body.classList.toggle("is-cinema", cinema);
        syncToggle(el.toggleCinema, cinema);
        persist();
        break;
      }
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
        event.preventDefault();
        jumpPreset(Number(event.key) - 1);
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

// ----------------------------------------------------------------------- url

function syncUrl(channel) {
  try {
    const url = new URL(window.location.href);
    if (channel) url.searchParams.set("s", channel.id);
    else url.searchParams.delete("s");
    window.history?.replaceState?.(null, "", url);
  } catch {
    /* file:// or a blocked history API — the URL is a nicety */
  }
}

// ---------------------------------------------------------------------- init

function init() {
  if (!CHANNELS.length) {
    showToast("No stations configured", 5000);
    return;
  }

  if (!channelAt(CHANNELS, state.index)) {
    state = { ...state, index: 0 };
  }

  buildTuner();
  buildFilters();
  wireAudioEvents();
  wireControls();
  wireKeyboard();
  wireTuner();
  wireMediaSession();
  wireVisibility();

  syncToggle(el.toggleSound, soundOn);
  syncToggle(el.toggleCompact, document.body.dataset.density === "compact");
  syncToggle(el.toggleFaceplate, document.body.dataset.layout === "faceplate");
  syncToggle(el.toggleCinema, document.body.classList.contains("is-cinema"));

  if (el.stationTotal) el.stationTotal.textContent = pad2(CHANNELS.length);
  if (el.stationsCount) el.stationsCount.textContent = String(CHANNELS.length);
  if (el.drawerCount) el.drawerCount.textContent = String(CHANNELS.length);

  applyVolume();
  renderStations();
  paintClock();
  window.setInterval(paintClock, 1000);
  updateMediaMetadata(channelAt(CHANNELS, state.index));
  syncUrl(channelAt(CHANNELS, state.index));
}

init();
