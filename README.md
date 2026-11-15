# Outpost Radio

A lakeside radio console for the late shift. Thirty live lofi, ambient, synth,
jazz, eclectic and classical streams, played by a single static page — no build
step, no dependencies, no backend.

The station name sits huge in Anton over the water; a wide frosted console holds
the tuner, transport and volume. Open it, press play, leave it on.

---

## Hosting

Everything is static: push the folder to any static host (GitHub Pages works
as-is). It must be served over HTTP rather than opened from `file://`, because
the player is built from ES modules.

---

## Controls

| Control | Mouse | Keyboard |
| --- | --- | --- |
| Play / pause | amber ring | `space` or `k` |
| Previous / next station | ◀ ▶ | `←` `→` |
| Tune | drag or scroll the tuner rail | `←` `→` |
| Mute | speaker icon | `m` |
| Volume | slider (wheel works too) | focus the slider, then arrows |
| Open stations | Stations button | `s` or `/` |
| Favorite current station | ★ beside any row | `f` |
| Jump to a favorite | any row | `1`–`6` |
| Shortcuts | ? button | `?` |
| Cinema mode | Settings | `c` |
| Close panels | × or the scrim | `esc` |

Tuning while paused only moves the selection; tuning while playing loads the
stream immediately. The tuner is a real slider: focus it and use the arrow keys,
or drag the needle.

---

## What is in the box

- **Console** — one wide frosted panel with the tuner as the primary instrument.
  Thirty ticks, a colour band per group, a draggable needle and a station readout.
- **Station drawer** — search by name, place or mood, filter by group or
  favorites, and see the last four stations you touched. Favorites get numbered
  presets (`1`–`6`) and are saved between visits.
- **Sleep timer** — 15, 30 or 60 minutes. It fades the stream out over eight
  seconds instead of cutting it, and shows a chip with the remaining time.
- **Crossfade in** — each new stream ramps up from silence, so switching stations
  does not start with a jolt.
- **Permalinks** — the address bar tracks the current station (`?s=fipjazz`), so
  a link opens on the same one.
- **Clock and on-air timer** — local time in the masthead, time on the current
  stream in the console.
- **Skins** — compact console, faceplate (solid hardware instead of glass) and
  cinema mode (chrome fades out until you hover). All persisted.
- **Relay click** — a tiny synthesized click when you tune, if you want it.
- **Toasts** — the console tells you what happened instead of failing silently.

Settings live in `localStorage` under `outpost-radio:v2`. A `v1` snapshot from
the old receiver is migrated on first load. There is no analytics or backend;
the only external requests are the streams themselves and Google Fonts.

---

## Stations

30 live streams across six groups. Every URL is probed before shipping.

| Group | Stations |
| --- | --- |
| **Lofi** | StreamAfrica Lofi · Laut.FM Lofi · Radio.co Lofi · Zeno Lofi I & II · FluxFM Chillhop |
| **Ambient** | Drone Zone · Deep Space One · Space Station · Synphaera · Groove Salad · SomaFM Lush |
| **Synth** | Vaporwaves · DEF CON Radio · Secret Agent · Nightride FM |
| **Jazz** | FIP Jazz · FIP Groove · Radio Swiss Jazz · Illinois Street Lounge |
| **Eclectic** | FIP · NTS 1 · KEXP · WFMU · Radio Paradise · Pink Floyd · Pink Floyd Hits · FIP World |
| **Classical** | Radio Swiss Classic · Venice Classic |

Upstream fixes worth knowing about, because they are easy to reintroduce:

- **Radio Paradise** `mellow-flac` serves FLAC inside Ogg, which Chrome will not
  play. The AAC endpoint is used instead.
- **SomaFM** `-128-aac` endpoints are ADTS AAC and flaky in some browsers;
  `-128-mp3` is used for compatibility.
- **NightRide FM** `chillsynth.m4a` returns 404; the `.mp3` relays are used.
- **FIP Sacré** answers 404 and **Linn** relays time out, so neither ships.
- **Zeno.fm** rejects requests from bots with 401 but serves browsers normally.
  The link checker sends a browser user-agent for that reason.

### If a station dies

The player retries once, then marks the station dead (struck through in the
drawer) and auto-skips to the next playable one instead of hanging on silence.
Clicking a struck-through station revives it for another try. The dead list is
per-session only — a station that comes back is available again next reload.

---

## The interface

- **Poster** — the current station name set large in Anton, bottom-left over the
  lake, with a status LED reading `STANDBY`, `TUNING`, `ON AIR`, `PAUSED` or
  `OFFLINE`.
- **Tuner** — ticks and group bands are derived from the station list, so the
  needle, bands and readout cannot drift apart. The needle follows your drag and
  snaps back to the selected station if you let go without moving.
- **Transport** — a thin amber ring rather than a filled orb. It fills in while a
  stream is loading or playing, so the same control always says what will happen.
- **Volume** — a filled rail behind the thumb, dimmed to muted cream when muted.
  The slider keeps its real position while muted so unmuting restores it.
- **Signal bars** — the three bars beside the active row animate only while audio
  is actually playing. They are decoration, not a VU meter.
- **Empty states** — no search results and an empty favorites list both say so.

---

## Verify

```powershell
# pure reducer: wrapping, dead-station skip, favorites, recents, filtering, data
node --test

# syntax check every module
node --check js/app.js

# probe all 30 stream URLs (exit code 1 if any are unreachable)
node scripts/check-links.mjs
```

`check-links.mjs` treats an `audio/*` content type as reachable. Some Icecast
front-ends answer `HEAD` with 405, so it falls back to a ranged `GET` and cancels
the body. Zeno.fm needs a browser user-agent, which the script sends.

---

## How it is put together

```
index.html          static shell: scene, poster, console, drawer, settings, help
styles.css          all styling, including skins, responsive rules and motion
js/channels.js      station data (id, name, group, place, note, url) + groups
js/player-core.js   pure reducer — no DOM, no audio, fully tested
js/app.js           DOM + <audio> wiring, tuner, drawer, timers, persistence
tests/              node:test cases against the reducer and the data
scripts/            stream link checker
assets/             lakeside-sunset.webp (shipped) + Lakeside-sunset.png (source)
```

The split is deliberate: every decision that can be wrong (wrap-around, skipping
dead stations, volume clamping, filtering, favorites, recents) lives in
`player-core.js` and is covered by `node --test`. The DOM layer only reacts.

### Honest limitations

- **No spectrum meter.** A real one needs `AnalyserNode`, which requires CORS on
  the audio stream. Icecast does not send `Access-Control-Allow-Origin`, and
  setting `audio.crossOrigin` would break playback outright. The signal bars are
  a CSS animation tied to playback state — they do not pretend to follow audio.
- **No per-track "now playing".** ICY metadata is blocked by CORS without a
  proxy, and this project has no backend. The console names the station, which is
  what the browser can actually know.
- **No YouTube extraction.** Pulling audio out of a YouTube live stream in the
  background needs a server-side downloader, violates YouTube's terms, and breaks
  whenever the player changes. It is deliberately not implemented; a link-out is
  the only honest option for a static page.
- Live streams cannot seek — there is no duration and no position to scrub.

### Glass fallback and motion

`backdrop-filter` is the whole look, and some browsers do not support it. A
`@supports not (backdrop-filter: …)` rule swaps the glass to a solid dark surface
so the text stays readable instead of turning into mud. All motion stops under
`prefers-reduced-motion: reduce`.

---

## Adding or changing a station

Edit `js/channels.js`:

```js
{ id: "unique-id", name: "Display Name", group: "Jazz", place: "Paris", note: "Jazz", url: "https://…" }
```

`group` must be one of `Lofi`, `Ambient`, `Synth`, `Jazz`, `Eclectic`,
`Classical` — the tests enforce this, along with unique ids, https-only URLs and
non-empty display fields. The tuner, drawer, readout and station count all read
from `CHANNELS`, so nothing else needs editing. Then run:

```powershell
node --test
node scripts/check-links.mjs
```

Station names, logos and streams belong to their respective broadcasters. This
is a personal player; nothing is re-hosted.

The wallpaper is the author's own
`Firewatch-Clock-Trials/wallpapers/Lakeside-sunset.png`, resized to 2560×1440 and
shipped as WebP.
