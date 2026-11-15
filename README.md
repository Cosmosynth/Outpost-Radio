# Outpost Radio

A local-only glass console for the live lofi, ambient and synth stations from
[Firewatch-Clock-Trials](https://github.com/Cosmosynth/Firewatch-Clock-Trials).
No OST files, no build step, no dependencies — just `index.html`, CSS, and two
ES modules.

Dusk ridges, frosted panels, an amber tuning needle. Open it, press play, leave
it on.

---

## Run it

ES modules do not load from `file://`, so double-clicking `index.html` will give
you a blank player. Serve the folder over HTTP:

```powershell
# from this folder
python -m http.server 5173 --bind 127.0.0.1
```

Then open <http://127.0.0.1:5173>.

On Windows you can also double-click **`serve.cmd`**, which starts the same
server and opens the browser.

Any static server works (`npx serve`, `php -S`, VS Code Live Server). There is
nothing to install or compile.

---

## Controls

| Control | Mouse | Keyboard |
| --- | --- | --- |
| Play / pause | big amber button | `space` or `k` |
| Previous / next station | ◀ ▶ | `←` `→` |
| Mute | speaker icon | `m` |
| Volume | slider (mouse wheel works too) | focus the slider, then arrows |
| Pick a station | any chip in the strip | tab to it, `enter` |

Your last station, volume and mute state are saved in `localStorage` under
`outpost-radio:v1`. Nothing is sent anywhere.

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

The player retries once, then marks the station dead (struck through in the
strip) and auto-skips to the next playable one instead of hanging on silence.
Clicking a struck-through station revives it for another try. The dead list is
per-session only — a station that comes back is available again next reload.

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
index.html          static shell: ridges, glass panels, controls
styles.css          all styling, including the glass fallback and reduced motion
js/channels.js      station data (id, name, group, url)
js/player-core.js   pure reducer — no DOM, no audio, fully tested
js/app.js           DOM + <audio> wiring, retry/skip, persistence, media session
tests/              node:test cases against the reducer and the data
scripts/            stream link checker
assets/             background image
```

The split is deliberate: every decision that can be wrong (wrap-around,
skipping dead stations, volume clamping, which station comes next) lives in
`player-core.js` and is covered by `node --test`. The DOM layer only reacts.

### Two honest limitations

- **The meter is decorative.** A real spectrum meter needs `AnalyserNode`,
  which requires CORS on the audio stream. Icecast does not send
  `Access-Control-Allow-Origin`, and setting `audio.crossOrigin` would break
  playback outright. The bars animate on a CSS timer while audio is playing and
  still when it is not. It is not pretending to be a VU meter.
- **No per-track "now playing".** ICY metadata is also blocked by CORS without
  a proxy, and this project has no backend. The dial shows the station, which
  is what the browser can actually know.

Live streams also cannot seek — there is no duration and no position to scrub.

### Glass fallback

`backdrop-filter` is the whole look, and some browsers (notably older Firefox on
Windows) do not support it. A `@supports not (backdrop-filter: …)` rule swaps
the panels to a solid dark surface so the text stays readable instead of
turning into mud. Backdrop blur is also paused when the tab is hidden, and all
drift/twinkle animation stops under `prefers-reduced-motion: reduce`.

---

## Adding or changing a station

Edit `js/channels.js`:

```js
{ id: "unique-id", name: "Display Name", group: "Lofi", url: "https://…" }
```

`group` must be one of `Lofi`, `Ambient`, `Synth`, `Radio` — the tests enforce
this, along with unique ids, https-only URLs, and a non-empty name. Then run:

```powershell
node --test
node scripts/check-links.mjs
```

Station names, logos and streams belong to their respective broadcasters. This
is a personal local player; nothing is re-hosted.

The background image is from the author's own
`Firewatch-Clock-Trials/wallpapers/sunset-bg.jpg`.
