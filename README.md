# Outpost Radio

A glass receiver on a lakeside dusk. Live lofi, ambient, synth and radio streams
from [Firewatch-Clock-Trials](https://github.com/Cosmosynth/Firewatch-Clock-Trials),
played by a single static page — no build step, no dependencies, no backend.

Anton station names over the wallpaper, a tall frosted receiver on the right, one
amber needle sliding across a 17-station tuner. Open it, press play, leave it on.

---

## Hosting

Everything is static: push the folder to any static host (GitHub Pages works
as-is). It must be served over HTTP rather than opened from `file://`, because
the player is built from ES modules.

---

## Controls

| Control | Mouse | Keyboard |
| --- | --- | --- |
| Play / pause | cream transport button | `space` or `k` |
| Previous / next station | ◀ ▶ | `←` `→` |
| Mute | speaker icon | `m` |
| Volume | slider (mouse wheel works too) | focus the slider, then arrows |
| Pick a station | any row in the station rail | tab to it, `enter` |

Your last station, volume and mute state are saved in `localStorage` under
`outpost-radio:v1`. There is no analytics or backend; the only external requests
are the streams themselves and Google Fonts.

Paused or idle, `←`/`→` only moves the selection. Playing, it tunes straight to
the next station.

---

## Stations

17 live streams, grouped by mood. Every URL was probed before shipping.

| Group | Stations |
| --- | --- |
| **Lofi** | StreamAfrica Lofi · Laut.FM Lofi · Radio.co Lofi · Zeno Lofi I & II · FluxFM Chillhop |
| **Ambient** | Drone Zone · Deep Space One · Space Station · Synphaera · Groove Salad |
| **Synth** | Vaporwaves · DEF CON Radio · Secret Agent |
| **Radio** | Pink Floyd · Pink Floyd Hits · Radio Paradise Mellow |

Upstream fixes worth knowing about, because they are easy to reintroduce:

- **Radio Paradise** `mellow-flac` returns FLAC wrapped in Ogg, which Chrome
  refuses to play. This uses `mellow-128` (AAC) instead.
- **SomaFM** `-128-aac` endpoints are ADTS AAC and flaky in some browsers;
  `-128-mp3` is used for compatibility.
- **NightRide FM** `chillsynth.m4a` now returns 404 and was dropped.
- **Zeno.fm** rejects requests from bots with 401 but serves browsers normally.
  The link checker sends a browser user-agent for that reason.

### If a station dies

The player retries once, then marks the station dead (struck through in the rail)
and auto-skips to the next playable one instead of hanging on silence. Clicking a
struck-through station revives it for another try. The dead list is per-session
only — a station that comes back is available again next reload.

---

## The interface

- **Poster** — the current station name set large in Anton, bottom-left over the
  lake, with a status LED reading `STANDBY`, `TUNING`, `ON AIR`, `PAUSED` or
  `OFFLINE`.
- **Receiver** — one frosted panel holding the tuner readout and scale, the
  transport, the volume control, and the vertical station rail. The rail groups
  stations by mood and keeps the dialled row in view.
- **Tuner** — ticks are derived from the station list, so the needle and the
  scale cannot drift apart; the readout is the station's place in the list.
- **Volume** — a filled rail behind the thumb, dimmed to muted cream when muted.
  The slider keeps its real position while muted so unmuting restores it.
- **Signal bars** — the three bars beside the active station animate only while
  audio is actually playing. They are decoration, not a VU meter.

---

## Verify

```powershell
# pure reducer: index wrap, dead-station skip, volume clamp, station data
node --test

# syntax check every module
node --check js/app.js

# probe all 17 stream URLs (exit code 1 if any are unreachable)
node scripts/check-links.mjs
```

`check-links.mjs` treats an `audio/*` content type as reachable. Some Icecast
front-ends answer `HEAD` with 405, so it uses a ranged `GET` and cancels the
body. Zeno.fm needs a browser user-agent, which the script sends.

---

## How it is put together

```
index.html          static shell: scene, poster, glass receiver, controls
styles.css          all styling, including the glass fallback and reduced motion
js/channels.js      station data (id, name, group, url) and the group order
js/player-core.js   pure reducer — no DOM, no audio, fully tested
js/app.js           DOM + <audio> wiring, retry/skip, persistence, media session
tests/              node:test cases against the reducer and the data
scripts/            stream link checker
assets/             lakeside-sunset.webp (shipped) + Lakeside-sunset.png (source)
```

The split is deliberate: every decision that can be wrong (wrap-around,
skipping dead stations, volume clamping, which station comes next) lives in
`player-core.js` and is covered by `node --test`. The DOM layer only reacts.

### Two honest limitations

- **No spectrum meter.** A real one needs `AnalyserNode`, which requires CORS on
  the audio stream. Icecast does not send `Access-Control-Allow-Origin`, and
  setting `audio.crossOrigin` would break playback outright. The signal bars
  beside the active station are a CSS animation tied to playback state — they
  do not pretend to follow the audio.
- **No per-track "now playing".** ICY metadata is also blocked by CORS without
  a proxy, and this project has no backend. The receiver names the station,
  which is what the browser can actually know.

Live streams also cannot seek — there is no duration and no position to scrub.

### Glass fallback

`backdrop-filter` is the whole look, and some browsers (notably older Firefox on
Windows) do not support it. A `@supports not (backdrop-filter: …)` rule swaps
the receiver to a solid dark surface so the text stays readable instead of
turning into mud. All motion stops under `prefers-reduced-motion: reduce`.

---

## Adding or changing a station

Edit `js/channels.js`:

```js
{ id: "unique-id", name: "Display Name", group: "Lofi", url: "https://…" }
```

`group` must be one of `Lofi`, `Ambient`, `Synth`, `Radio` — the tests enforce
this, along with unique ids, https-only URLs, and a non-empty name. The tuner,
readout and station count all read from `CHANNELS`, so nothing else needs
editing. Then run:

```powershell
node --test
node scripts/check-links.mjs
```

Station names, logos and streams belong to their respective broadcasters. This
is a personal player; nothing is re-hosted.

The wallpaper is the author's own
`Firewatch-Clock-Trials/wallpapers/Lakeside-sunset.png`, resized to 2560×1440 and
shipped as WebP.
