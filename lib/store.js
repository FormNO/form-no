/**
 * The filing store.
 *
 * Filings are kept in KV and that is what the site shows. Each one carries a
 * transaction hash once it has been written to Base; until then it is waiting
 * in the queue. This lets the wall run before the contract exists, and lets
 * everything already filed go on chain, in order, the day it does.
 *
 * KV layout:
 *   wall:v2        the filings, oldest first
 *   tally          signature and objection counts, keyed by filing id
 *   marks:<acct>   what one account has signed or objected to
 *   user:<acct>    { u, avatar, past[] } for one account
 *   handle:<name>  account id for a handle, current or former
 *   day:<date>:<acct>   the daily allowance
 */

const LIST_KEY = "wall:v2";
const MAX_KEPT = 2000;

export async function readFilings(env) {
  if (!env.RATE) return [];
  const raw = await env.RATE.get(LIST_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeFilings(env, list) {
  if (!env.RATE) return;
  await env.RATE.put(LIST_KEY, JSON.stringify(list.slice(-MAX_KEPT)));
}

export function newId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Add a filing and hand back the stored entry, numbered from one. */
export async function addFiling(env, { accountId, username, message, hash }) {
  const list = await readFilings(env);
  const entry = {
    id: newId(),
    seq: (list.length ? list[list.length - 1].seq : 0) + 1,
    aid: String(accountId),
    u: username,
    m: message,
    t: Math.floor(Date.now() / 1000),
    h: hash || null,
  };
  list.push(entry);
  await writeFilings(env, list);
  return entry;
}

export async function readTally(env) {
  if (!env.RATE) return {};
  const raw = await env.RATE.get("tally");
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export async function readMarks(env, accountId) {
  if (!env.RATE || !accountId) return {};
  const raw = await env.RATE.get("marks:" + accountId);
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export async function readHidden(env) {
  const site = env.SITE_URL || "";
  const out = new Set();
  if (!site) return out;
  try {
    const res = await fetch(site + "/hidden.json", { cf: { cacheTtl: 60 } });
    if (res.ok) {
      const data = await res.json();
      (data.hashes || []).forEach((h) => out.add(String(h).toLowerCase()));
    }
  } catch {
    /* if the list cannot be read, nothing is hidden */
  }
  return out;
}

/** Public shape: what the page and the pages rendered server-side both use. */
export function publicEntry(e) {
  return {
    id: e.id,
    seq: e.seq,
    username: e.u,
    message: e.m,
    timestamp: e.t,
    hash: e.h || null,
  };
}

export function isLive(env) {
  return !!(env.CONTRACT && env.RELAYER_KEY);
}

export { LIST_KEY, MAX_KEPT };
