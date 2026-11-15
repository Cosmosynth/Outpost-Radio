#!/usr/bin/env node
/**
 * Probes every station URL and reports status + content type.
 *
 * A stream that 404s or returns HTML is a station that will silently fail in
 * the browser, so this is worth running whenever channels.js changes.
 *
 * Two real-world quirks are handled here:
 *   - Some Icecast front-ends answer HEAD with 405, so HEAD is tried first and
 *     a ranged GET is the fallback.
 *   - A few CDNs (FluxFM/QuantumCast) send a GET response that Node's strict
 *     HTTP parser rejects but browsers accept. HEAD succeeds there, which is
 *     enough to prove the front door is alive.
 *
 * Usage: node scripts/check-links.mjs [--verbose]
 */
import { CHANNELS } from "../js/channels.js";

const HEAD_TIMEOUT_MS = 8_000;
const GET_TIMEOUT_MS = 10_000;
const verbose = process.argv.includes("--verbose");

// Some Icecast front-ends reject requests that do not look like a browser.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Range: "bytes=0-1023",
  Accept: "*/*",
};

const PLAYABLE = /audio|mpeg|aac|ogg|mp3|flac/i;

async function request(url, method) {
  const response = await fetch(url, {
    method,
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(method === "HEAD" ? HEAD_TIMEOUT_MS : GET_TIMEOUT_MS),
  });
  await response.body?.cancel?.();
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "?",
    ok: response.ok,
  };
}

async function probe(channel) {
  let head = null;
  try {
    head = await request(channel.url, "HEAD");
    if (head.ok && PLAYABLE.test(head.type)) {
      return { channel, ok: true, status: head.status, type: head.type, via: "HEAD" };
    }
  } catch {
    /* fall through to GET */
  }

  try {
    const get = await request(channel.url, "GET");
    return {
      channel,
      ok: get.ok && PLAYABLE.test(get.type),
      status: get.status,
      type: get.type,
      via: "GET",
    };
  } catch (error) {
    // Keep a usable HEAD result even if the streamed GET cannot be parsed.
    if (head?.ok) {
      return { channel, ok: true, status: head.status, type: head.type, via: "HEAD" };
    }
    return {
      channel,
      ok: false,
      status: "ERR",
      type: error.cause?.code ?? error.name ?? "error",
      via: "GET",
    };
  }
}

const results = await Promise.all(CHANNELS.map(probe));
const failed = results.filter((result) => !result.ok);

for (const { channel, ok, status, type, via } of results) {
  if (!ok || verbose) {
    const mark = ok ? "OK  " : "FAIL";
    console.log(
      `${mark} ${String(status).padEnd(4)} ${type.padEnd(24)} ${channel.name}  <${channel.url}>  [${via}]`,
    );
  }
}

console.log(`\n${results.length - failed.length}/${results.length} stations reachable`);

if (failed.length > 0) {
  console.log("\nUnreachable:");
  for (const { channel, status, type } of failed) {
    console.log(`  - ${channel.name} (${channel.id}): ${status} ${type}`);
  }
  process.exitCode = 1;
}
