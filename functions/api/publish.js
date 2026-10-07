import { readFilings, writeFilings, isLive } from "../../lib/store.js";

/**
 * POST /api/publish   { key, limit }
 *
 * Writes filings that are still waiting to Base, oldest first, so the order
 * people filed in is the order they go on chain. Run it once the contract is
 * deployed; call it again until nothing is left.
 *
 * Protected by PUBLISH_KEY, which only you know. A batch is kept small because
 * a Cloudflare request has a time budget and each transaction takes a moment.
 *
 * Environment variables:
 *   CONTRACT, RELAYER_KEY, RPC_URL, PUBLISH_KEY
 */

const ABI = ["function reject(string username, string message) external"];

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

  const limit = Math.min(Math.max(parseInt(body.limit || "5", 10) || 5, 1), 10);

  const filings = await readFilings(env);
  const waiting = filings.filter((e) => !e.h);

  if (!waiting.length) return json({ ok: true, written: 0, remaining: 0 });

  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(
    env.RPC_URL || "https://mainnet.base.org",
    8453,
    { staticNetwork: true }
  );
  const wallet = new ethers.Wallet(env.RELAYER_KEY, provider);
  const contract = new ethers.Contract(env.CONTRACT, ABI, wallet);

  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const done = [];
  const failed = [];

  for (const entry of waiting.slice(0, limit)) {
    try {
      const tx = await contract.reject(entry.u, entry.m, { nonce });
      entry.h = String(tx.hash).toLowerCase();
      nonce += 1;
      done.push({ id: entry.id, hash: entry.h });
    } catch (e) {
      failed.push({
        id: entry.id,
        reason: String(e?.shortMessage || e?.message || e).slice(0, 140),
      });
      break; // stop on the first failure rather than burning the whole batch
    }
  }

  if (done.length) await writeFilings(env, filings);

  return json({
    ok: true,
    written: done.length,
    remaining: filings.filter((e) => !e.h).length,
    done,
    failed,
  });
}
