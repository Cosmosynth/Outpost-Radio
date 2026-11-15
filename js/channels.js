/**
 * Live stations carried over from Firewatch-Clock-Trials.
 *
 * Every URL here was probed before shipping (`node scripts/check-links.mjs`).
 * Two upstream fixes worth knowing about:
 *   - Radio Paradise `mellow-flac` serves FLAC inside Ogg, which Chrome will not
 *     play. Switched to the AAC endpoint.
 *   - SomaFM `-128-aac` endpoints are ADTS AAC; `-128-mp3` is safer in browsers.
 *   - NightRide FM `chillsynth.m4a` returns 404 and was dropped.
 */
export const CHANNELS = [
  // ---------- LOFI ----------
  { id: "streamafrica", name: "StreamAfrica Lofi", group: "Lofi", url: "https://play.streamafrica.net/lofiradio" },
  { id: "lautfm",       name: "Laut.FM Lofi",      group: "Lofi", url: "https://lofi.stream.laut.fm/lofi" },
  { id: "radioco",      name: "Radio.co Lofi",     group: "Lofi", url: "https://streamer.radio.co/s0635c8b0d/listen" },
  { id: "zeno-one",     name: "Zeno Lofi I",       group: "Lofi", url: "https://stream.zeno.fm/f3wvbbqmdg8uv" },
  { id: "zeno-two",     name: "Zeno Lofi II",      group: "Lofi", url: "https://stream.zeno.fm/0r0xa792kwzuv" },
  { id: "fluxfm",       name: "FluxFM Chillhop",   group: "Lofi", url: "https://channels.fluxfm.de/chillhop/externalembedflxhp/stream.mp3" },

  // ---------- AMBIENT ----------
  { id: "dronezone",    name: "Drone Zone",        group: "Ambient", url: "https://ice1.somafm.com/dronezone-256-mp3" },
  { id: "deepspaceone", name: "Deep Space One",    group: "Ambient", url: "https://ice1.somafm.com/deepspaceone-128-mp3" },
  { id: "spacestation", name: "Space Station",     group: "Ambient", url: "https://ice1.somafm.com/spacestation-128-mp3" },
  { id: "synphaera",    name: "Synphaera",         group: "Ambient", url: "https://ice1.somafm.com/synphaera-128-mp3" },
  { id: "groovesalad",  name: "Groove Salad",      group: "Ambient", url: "https://ice1.somafm.com/groovesalad-256-mp3" },

  // ---------- SYNTH ----------
  { id: "vaporwaves",   name: "Vaporwaves",        group: "Synth", url: "https://ice1.somafm.com/vaporwaves-128-mp3" },
  { id: "defcon",       name: "DEF CON Radio",     group: "Synth", url: "https://ice1.somafm.com/defcon-128-mp3" },
  { id: "secretagent",  name: "Secret Agent",      group: "Synth", url: "https://ice1.somafm.com/secretagent-128-mp3" },

  // ---------- RADIO ----------
  { id: "pinkfloyd",    name: "Pink Floyd",        group: "Radio", url: "https://streaming.exclusive.radio/er/pinkfloyd/icecast.audio" },
  { id: "floydhits",    name: "Pink Floyd Hits",   group: "Radio", url: "https://streaming.exclusive.radio/er/pinkfloydhits/icecast.audio" },
  { id: "radioparadise", name: "Radio Paradise",   group: "Radio", url: "https://stream.radioparadise.com/mellow-128" },
];

export const GROUPS = ["Lofi", "Ambient", "Synth", "Radio"];
