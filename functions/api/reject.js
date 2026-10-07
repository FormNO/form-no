import { currentUser } from "../../lib/session.js";
import { addFiling, isLive } from "../../lib/store.js";

/**
 * POST /api/reject   { message }
 *
 * The handle comes from the signed-in X account, never from the request body,
 * so nobody can file under someone else's name.
 *
 * The filing is recorded immediately. If the contract is live it also goes to
 * Base in the same request; if it is not, it waits in the queue and is written
 * when the wall opens. Either way the person's place in the order is fixed the
 * moment they file.
 *
 * Environment variables:
 *   CONTRACT, RELAYER_KEY, RPC_URL   (only needed once filing goes on chain)
 * KV binding:
 *   RATE
 */

const ABI = ["function reject(string username, string message) external"];

const DAILY_LIMIT = 1; // filings allowed per account per day

const TLDS =
  "com|net|org|io|co|me|xyz|app|fun|gg|link|site|online|store|shop|live|tv|biz|info|club|space|finance|exchange|eth|sol|to|cc|ru|vip|pro";

const SPAM = [
  /https?:\/\//i,
  /www\./i,
  new RegExp("\\b[a-z0-9-]{2,}\\.(" + TLDS + ")\\b", "i"),
  /\b[a-z0-9-]{2,}\s*[\[(]?\s*dot\s*[\])]?\s*[a-z]{2,}\b/i,
  /0x[a-fA-F0-9]{8,}/,
  /@[a-z0-9_]{3,}/i,
  /t\.me|telegram\.|discord\.|chat\.whatsapp/i,
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const byteLen = (s) => new TextEncoder().encode(s).length;

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in with X first.", needsAuth: true }, 401);

  if (!env.RATE) return json({ error: "Filing is off right now." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const message = String(body.message || "").trim();
  const username = String(user.u).slice(0, 24);

  if (!message) return json({ error: "Write something first." }, 400);
  if (byteLen(message) > 200) return json({ error: "That is too long." }, 400);
  if (SPAM.some((r) => r.test(message)))
    return json({ error: "Links and addresses are not allowed." }, 400);

  // ---- one per account per day ----
  const dayKey = `day:${new Date().toISOString().slice(0, 10)}:${user.id}`;
  const used = parseInt((await env.RATE.get(dayKey)) || "0", 10);
  if (used >= DAILY_LIMIT)
    return json({ error: "You have filed today. Come back tomorrow." }, 429);

  // ---- write to the chain, when there is one ----
  let hash = null;

  if (isLive(env)) {
    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(
        env.RPC_URL || "https://mainnet.base.org",
        8453,
        { staticNetwork: true }
      );
      const wallet = new ethers.Wallet(env.RELAYER_KEY, provider);
      const contract = new ethers.Contract(env.CONTRACT, ABI, wallet);

      // Two requests arriving together can be handed the same nonce. Bump it
      // and retry rather than failing the second person.
      let tx;
      let lastError;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const nonce =
            (await provider.getTransactionCount(wallet.address, "pending")) + attempt;
          tx = await contract.reject(username, message, { nonce });
          break;
        } catch (err) {
          lastError = err;
          const m = String(err?.shortMessage || err?.message || err);
          if (!/nonce|replacement|already known/i.test(m)) throw err;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }

      if (!tx) throw lastError;
      hash = String(tx.hash).toLowerCase();
    } catch {
      // The chain refused. Keep the filing rather than losing what they wrote;
      // it joins the queue and goes up with the next batch.
      hash = null;
    }
  }

  const entry = await addFiling(env, {
    accountId: user.id,
    username,
    message,
    hash,
  });

  await env.RATE.put(dayKey, String(used + 1), { expirationTtl: 86400 });
  await env.RATE.put("handle:" + username.toLowerCase(), String(user.id));

  return json({
    ok: true,
    id: entry.id,
    seq: entry.seq,
    hash,
    pending: !hash,
    username,
  });
}
