import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS,
  DEFAULT_VOLUME,
  clampVolume,
  wrapIndex,
  createState,
  isDead,
  nextPlayable,
  selectStation,
  tune,
  markDead,
  setVolume,
  toggleMute,
  channelAt,
  formatVolume,
  statusLabel,
} from "../js/player-core.js";

import { CHANNELS, GROUPS } from "../js/channels.js";

const fakeChannels = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `Ch ${i}`, group: "Lofi", url: `https://x/${i}` }));

// ---------------------------------------------------------------- indexes

test("wrapIndex wraps negative and overflowing indexes", () => {
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(12, 5), 2);
  assert.equal(wrapIndex(3, 5), 3);
});

test("wrapIndex returns -1 for an unusable length", () => {
  assert.equal(wrapIndex(0, 0), -1);
  assert.equal(wrapIndex(0, -3), -1);
});

// ---------------------------------------------------------------- volume

test("clampVolume clamps to 0..1", () => {
  assert.equal(clampVolume(-2), 0);
  assert.equal(clampVolume(4), 1);
  assert.equal(clampVolume(0.42), 0.42);
});

test("clampVolume falls back on unreadable input", () => {
  assert.equal(clampVolume(Number.NaN), DEFAULT_VOLUME);
  assert.equal(clampVolume("loud", 0.5), 0.5);
});

// ---------------------------------------------------------------- state

test("createState wraps a bad index and filters bad dead entries", () => {
  const state = createState({ channels: fakeChannels, index: 9, dead: [1, 1, 99, -2, "x"] });
  assert.equal(state.index, 4);
  assert.deepEqual(state.dead, [1]);
  assert.equal(state.status, STATUS.IDLE);
  assert.equal(state.volume, DEFAULT_VOLUME);
});

test("selectStation wraps out-of-range and rejects an empty list", () => {
  const state = createState({ channels: fakeChannels });
  assert.equal(selectStation(state, fakeChannels, 7).index, 2);
  const broken = selectStation(state, [], 0);
  assert.equal(broken.status, STATUS.ERROR);
});

test("selectStation keeps the current playback status", () => {
  const state = { ...createState({ channels: fakeChannels }), status: STATUS.PLAYING };
  const next = selectStation(state, fakeChannels, 2);
  assert.equal(next.index, 2);
  assert.equal(next.status, STATUS.PLAYING);
});

test("isDead only matches indexes in the dead list", () => {
  const state = { ...createState({ channels: fakeChannels }), dead: [1, 3] };
  assert.equal(isDead(state, 1), true);
  assert.equal(isDead(state, 2), false);
});

test("createState falls back to the first station for a non-numeric index", () => {
  assert.equal(createState({ channels: fakeChannels, index: "2" }).index, 0);
  assert.equal(createState({ channels: fakeChannels, index: undefined }).index, 0);
});

// ---------------------------------------------------------------- tuning

test("tune forward wraps last to first", () => {
  const state = { ...createState({ channels: fakeChannels }), index: 4 };
  assert.equal(tune(state, fakeChannels, 1).index, 0);
});

test("tune backward wraps first to last", () => {
  const state = { ...createState({ channels: fakeChannels }), index: 0 };
  assert.equal(tune(state, fakeChannels, -1).index, 4);
});

test("tune skips dead stations in both directions", () => {
  const forward = { ...createState({ channels: fakeChannels }), index: 0, dead: [1, 2] };
  assert.equal(tune(forward, fakeChannels, 1).index, 3);

  const backward = { ...createState({ channels: fakeChannels }), index: 3, dead: [1, 2] };
  assert.equal(tune(backward, fakeChannels, -1).index, 0);
});

test("nextPlayable starts at the first station when nothing is selected", () => {
  assert.equal(nextPlayable(fakeChannels, -1, [], 1), 0);
  assert.equal(nextPlayable(fakeChannels, -1, [], -1), 4);
});

test("tune reports an error when every station is dead", () => {
  const state = { ...createState({ channels: fakeChannels }), dead: [0, 1, 2, 3, 4], index: 0 };
  const next = tune(state, fakeChannels, 1);
  assert.equal(next.status, STATUS.ERROR);
  assert.equal(next.index, 0);
  assert.match(next.error, /offline/i);
});

test("nextPlayable returns -1 when nothing is playable", () => {
  assert.equal(nextPlayable(fakeChannels, 0, [0, 1, 2, 3, 4], 1), -1);
  assert.equal(nextPlayable([], 0, [], 1), -1);
});

// ---------------------------------------------------------------- dead list

test("markDead is idempotent and ignores out-of-range indexes", () => {
  const state = createState({ channels: fakeChannels });
  const once = markDead(state, fakeChannels, 2);
  const twice = markDead(once, fakeChannels, 2);
  assert.deepEqual(once.dead, [2]);
  assert.deepEqual(twice.dead, [2]);
  assert.deepEqual(markDead(state, fakeChannels, 99).dead, []);
});

test("markDead does not mutate the previous state", () => {
  const state = createState({ channels: fakeChannels });
  const next = markDead(state, fakeChannels, 1);
  assert.deepEqual(state.dead, []);
  assert.deepEqual(next.dead, [1]);
});

// ---------------------------------------------------------------- misc

test("setVolume clamps and does not mutate", () => {
  const state = createState({ channels: fakeChannels });
  const next = setVolume(state, 3);
  assert.equal(next.volume, 1);
  assert.equal(state.volume, DEFAULT_VOLUME);
});

test("toggleMute flips without changing volume", () => {
  const state = createState({ channels: fakeChannels, volume: 0.4 });
  const muted = toggleMute(state);
  assert.equal(muted.muted, true);
  assert.equal(muted.volume, 0.4);
  assert.equal(toggleMute(muted).muted, false);
});

test("formatVolume respects mute", () => {
  const base = createState({ channels: fakeChannels, volume: 0.55 });
  assert.equal(formatVolume(base), "55%");
  assert.equal(formatVolume(toggleMute(base)), "0%");
});

test("statusLabel maps every status", () => {
  const base = createState({ channels: fakeChannels });
  assert.equal(statusLabel(base), "STANDBY");
  assert.equal(statusLabel({ ...base, status: STATUS.PLAYING }), "ON AIR");
  assert.equal(statusLabel({ ...base, status: STATUS.LOADING }), "TUNING");
  assert.equal(statusLabel({ ...base, status: STATUS.PAUSED }), "PAUSED");
  assert.equal(statusLabel({ ...base, status: STATUS.ERROR, error: "boom" }), "boom");
});

test("channelAt returns null for a missing index", () => {
  assert.equal(channelAt(CHANNELS, 0).id, "streamafrica");
  assert.equal(channelAt(CHANNELS, 999), null);
});

// ---------------------------------------------------------------- station data

test("station data is well formed", () => {
  assert.ok(CHANNELS.length >= 15, `expected at least 15 stations, got ${CHANNELS.length}`);

  const ids = new Set();
  for (const channel of CHANNELS) {
    assert.ok(channel.id, "station needs an id");
    assert.ok(!ids.has(channel.id), `duplicate id: ${channel.id}`);
    ids.add(channel.id);

    assert.ok(channel.name.length >= 2, `station ${channel.id} needs a name`);
    assert.ok(GROUPS.includes(channel.group), `station ${channel.id} has unknown group ${channel.group}`);
    assert.match(channel.url, /^https:\/\//, `station ${channel.id} must use https`);
  }
});

test("every station is reachable in the data model", () => {
  CHANNELS.forEach((channel, index) => {
    assert.equal(channelAt(CHANNELS, index).id, channel.id);
  });
});
