import { currentUser } from "../../lib/session.js";
import { readFilings } from "../../lib/store.js";

/**
 * POST /api/vote   { id, dir }   dir: "sign" | "nah"
 * The counts themselves are served by /api/wall.
 *
 * Signatures live in the store rather than on the chain. Writing a transaction
 * for every signature would mean paying gas per tap. Filings are permanent;
 * signatures are a counter. One per account per filing, which also means a
 * signature follows the person across devices.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const TALLY_KEY = "tally";

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in with X first.", needsAuth: true }, 401);

  if (!env.RATE) return json({ error: "Signing is off right now." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const id = String(body.id || "");
  const dir = body.dir === "nah" ? "nah" : "sign";

  if (!/^[a-f0-9]{24}$/.test(id)) return json({ error: "Unknown filing" }, 400);

  const filings = await readFilings(env);
  const entry = filings.find((e) => e.id === id);
  if (!entry) return json({ error: "Unknown filing" }, 404);

  // signing your own filing would make the count meaningless
  if (String(entry.aid) === String(user.id)) {
    return json({ error: "You cannot sign your own filing." }, 409);
  }

  const marksKey = "marks:" + user.id;
  const marksRaw = await env.RATE.get(marksKey);
  const marks = marksRaw ? JSON.parse(marksRaw) : {};

  if (marks[id]) return json({ error: "You already answered this one." }, 409);

  const tallyRaw = await env.RATE.get(TALLY_KEY);
  const tally = tallyRaw ? JSON.parse(tallyRaw) : {};
  const row = tally[id] || { s: 0, n: 0 };

  if (dir === "sign") row.s += 1;
  else row.n += 1;

  tally[id] = row;
  marks[id] = dir;

  await env.RATE.put(TALLY_KEY, JSON.stringify(tally));
  await env.RATE.put(marksKey, JSON.stringify(marks));

  return json({ ok: true, id, ...row });
}
