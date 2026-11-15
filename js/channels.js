/**
 * Live stations.
 *
 * Every URL here was probed before shipping (`node scripts/check-links.mjs`).
 * Upstream fixes worth knowing about:
 *   - Radio Paradise `mellow-flac` serves FLAC inside Ogg, which Chrome will not
 *     play. Switched to the AAC endpoints.
 *   - SomaFM `-128-aac` endpoints are ADTS AAC; `-128-mp3` is safer in browsers.
 *   - NightRide FM `chillsynth.m4a` returns 404; the `.mp3` relays are used.
 *   - FIP Sacré answers 404 and Linn's relays time out, so neither ships.
 *
 * `place` and `note` are display metadata only — they are not fetched.
 */
export const CHANNELS = [
  // ---------- LOFI ----------
  { id: "streamafrica",  name: "StreamAfrica Lofi",   group: "Lofi",      place: "Cape Town",     note: "Lofi",        url: "https://play.streamafrica.net/lofiradio" },
  { id: "lautfm",        name: "Laut.FM Lofi",        group: "Lofi",      place: "Berlin",        note: "Lofi",        url: "https://lofi.stream.laut.fm/lofi" },
  { id: "radioco",       name: "Radio.co Lofi",       group: "Lofi",      place: "London",        note: "Lofi",        url: "https://streamer.radio.co/s0635c8b0d/listen" },
  { id: "zeno-one",      name: "Zeno Lofi I",         group: "Lofi",      place: "Online",        note: "Lofi",        url: "https://stream.zeno.fm/f3wvbbqmdg8uv" },
  { id: "zeno-two",      name: "Zeno Lofi II",        group: "Lofi",      place: "Online",        note: "Lofi",        url: "https://stream.zeno.fm/0r0xa792kwzuv" },
  { id: "fluxfm",        name: "FluxFM Chillhop",     group: "Lofi",      place: "Berlin",        note: "Chillhop",    url: "https://channels.fluxfm.de/chillhop/externalembedflxhp/stream.mp3" },

  // ---------- AMBIENT ----------
  { id: "dronezone",     name: "Drone Zone",          group: "Ambient",   place: "San Francisco", note: "Drone",       url: "https://ice1.somafm.com/dronezone-256-mp3" },
  { id: "deepspaceone",  name: "Deep Space One",      group: "Ambient",   place: "San Francisco", note: "Deep space",  url: "https://ice1.somafm.com/deepspaceone-128-mp3" },
  { id: "spacestation",  name: "Space Station",       group: "Ambient",   place: "San Francisco", note: "Space",       url: "https://ice1.somafm.com/spacestation-128-mp3" },
  { id: "synphaera",     name: "Synphaera",           group: "Ambient",   place: "San Francisco", note: "Cinematic",   url: "https://ice1.somafm.com/synphaera-128-mp3" },
  { id: "groovesalad",   name: "Groove Salad",        group: "Ambient",   place: "San Francisco", note: "Downtempo",   url: "https://ice1.somafm.com/groovesalad-256-mp3" },
  { id: "lush",          name: "SomaFM Lush",         group: "Ambient",   place: "San Francisco", note: "Vocal chill", url: "https://ice1.somafm.com/lush-128-mp3" },

  // ---------- SYNTH ----------
  { id: "vaporwaves",    name: "Vaporwaves",          group: "Synth",     place: "San Francisco", note: "Vaporwave",   url: "https://ice1.somafm.com/vaporwaves-128-mp3" },
  { id: "defcon",        name: "DEF CON Radio",       group: "Synth",     place: "San Francisco", note: "Electronic",  url: "https://ice1.somafm.com/defcon-128-mp3" },
  { id: "secretagent",   name: "Secret Agent",        group: "Synth",     place: "San Francisco", note: "Spy lounge",  url: "https://ice1.somafm.com/secretagent-128-mp3" },
  { id: "nightride",     name: "Nightride FM",        group: "Synth",     place: "Montreal",      note: "Synthwave",   url: "https://stream.nightride.fm/nightride.mp3" },

  // ---------- JAZZ ----------
  { id: "fipjazz",       name: "FIP Jazz",            group: "Jazz",      place: "Paris",         note: "Jazz",        url: "https://icecast.radiofrance.fr/fipjazz-midfi.mp3" },
  { id: "fipgroove",     name: "FIP Groove",          group: "Jazz",      place: "Paris",         note: "Soul / funk", url: "https://icecast.radiofrance.fr/fipgroove-midfi.mp3" },
  { id: "swissjazz",     name: "Radio Swiss Jazz",    group: "Jazz",      place: "Bern",          note: "Jazz",        url: "https://stream.srg-ssr.ch/m/rsj/mp3_128" },
  { id: "illstreet",     name: "Illinois Street Lounge", group: "Jazz",   place: "San Francisco", note: "Lounge",      url: "https://ice1.somafm.com/illstreet-128-mp3" },

  // ---------- ECLECTIC ----------
  { id: "fip",           name: "FIP",                 group: "Eclectic",  place: "Paris",         note: "Eclectic",    url: "https://icecast.radiofrance.fr/fip-midfi.mp3" },
  { id: "nts",           name: "NTS 1",               group: "Eclectic",  place: "London",        note: "Eclectic",    url: "https://stream-relay-geo.ntslive.net/stream" },
  { id: "kexp",          name: "KEXP",                group: "Eclectic",  place: "Seattle",       note: "Indie",       url: "https://kexp-mp3-128.streamguys1.com/kexp128.mp3" },
  { id: "wfmu",          name: "WFMU",                group: "Eclectic",  place: "Jersey City",   note: "Freeform",    url: "https://stream0.wfmu.org/freeform-128k" },
  { id: "radioparadise", name: "Radio Paradise",      group: "Eclectic",  place: "Paradise, CA",  note: "Eclectic",    url: "https://stream.radioparadise.com/mellow-128" },
  { id: "pinkfloyd",     name: "Pink Floyd",          group: "Eclectic",  place: "Artist radio",  note: "Rock",        url: "https://streaming.exclusive.radio/er/pinkfloyd/icecast.audio" },
  { id: "floydhits",     name: "Pink Floyd Hits",     group: "Eclectic",  place: "Artist radio",  note: "Rock",        url: "https://streaming.exclusive.radio/er/pinkfloydhits/icecast.audio" },
  { id: "fipworld",      name: "FIP World",           group: "Eclectic",  place: "Paris",         note: "World",       url: "https://icecast.radiofrance.fr/fipworld-midfi.mp3" },

  // ---------- CLASSICAL ----------
  { id: "swissclassic",  name: "Radio Swiss Classic", group: "Classical", place: "Bern",          note: "Classical",   url: "https://stream.srg-ssr.ch/m/rsc_de/mp3_128" },
  { id: "veniceclassic", name: "Venice Classic",      group: "Classical", place: "Venice",        note: "Classical",   url: "https://uk2.streamingpulse.com/ssl/vcr1" },
];

/** Display order of the groups in the tuner and the station rail. */
export const GROUPS = ["Lofi", "Ambient", "Synth", "Jazz", "Eclectic", "Classical"];

/** Accent per group, mirrored in CSS as `--group-accent`. */
export const GROUP_ACCENTS = {
  Lofi: "#ff9e64",
  Ambient: "#a99bff",
  Synth: "#67d7e8",
  Jazz: "#ff9fb4",
  Eclectic: "#ffe9d6",
  Classical: "#a9d3a2",
};

export function indexOfChannel(id) {
  return CHANNELS.findIndex((channel) => channel.id === id);
}
