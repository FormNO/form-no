import { readFilings, writeFilings, isLive } from "../../lib/store.js";

/**
 * POST /api/publish   { key, limit }
 *
 * Empties the queue that built up before the contract existed. Filings go to
 * Robinhood Chain oldest first, so the order people filed in is the order they
 * take on the wall. Run it once the contract is deployed, and again until
 * nothing is left.
 *
 * The whole batch travels in one transaction through rejectMany. That keeps
 * the gas cost down and, more to the point, makes the run all or nothing: the
 * contract reverts if any single filing in the batch is malformed, so the
 * queue is never left half written.
 *
 * Protected by PUBLISH_KEY, which only the operator knows.
 *
 * Environment variables:
 *   CONTRACT, RELAYER_KEY, RPC_URL, PUBLISH_KEY
 */

const ABI = [
  "function rejectMany(string[] handles, string[] messages, uint64[] filedAt) external",
];

// The contract refuses anything larger. Cloudflare also puts a time budget on
// a request, so the default stays well under it.
const MAX_BATCH = 100;
const DEFAULT_BATCH = 25;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, env }) {
  if (!env.PUBLISH_KEY) return json({ error: "Publishing is not configured." }, 503);
  if (!isLive(env)) return json({ error: "No contract to write to yet." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  if (String(body.key || "") !== String(env.PUBLISH_KEY)) {
    return json({ error: "Not allowed." }, 403);
  }

  const asked = parseInt(body.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(asked) ? asked : DEFAULT_BATCH, 1), MAX_BATCH);

  const filings = await readFilings(env);
  const waiting = filings.filter((e) => !e.h);

  if (!waiting.length) return json({ ok: true, written: 0, remaining: 0 });

  const batch = waiting.slice(0, limit);

  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(
    env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    4663,
    { staticNetwork: true }
  );
  const wallet = new ethers.Wallet(env.RELAYER_KEY, provider);
  const contract = new ethers.Contract(env.CONTRACT, ABI, wallet);

  let tx;
  try {
    tx = await contract.rejectMany(
      batch.map((e) => e.u),
      batch.map((e) => e.m),
      batch.map((e) => e.t)
    );
  } catch (e) {
    return json(
      {
        ok: false,
        written: 0,
        remaining: waiting.length,
        reason: String(e?.shortMessage || e?.message || e).slice(0, 180),
      },
      502
    );
  }

  // Every filing in the batch shares the transaction that carried it. Their
  // order inside it is the order they were sent, which is the order they were
  // filed, and the sequence number the contract gives each one follows from
  // that. Nothing is recorded until the send comes back without an error.
  const hash = String(tx.hash).toLowerCase();
  for (const entry of batch) entry.h = hash;

  await writeFilings(env, filings);

  return json({
    ok: true,
    written: batch.length,
    remaining: filings.filter((e) => !e.h).length,
    hash,
  });
}
