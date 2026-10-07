import { currentUser } from "../../lib/session.js";
import {
  readFilings,
  readTally,
  readMarks,
  publicEntry,
  isLive,
} from "../../lib/store.js";

/**
 * GET /api/wall
 * The whole wall in one request: filings, signature counts, the viewer's own
 * marks, and who they are signed in as.
 *
 * The browser never talks to the chain. Filings are served from the store,
 * each carrying its transaction hash once it has been written to Base.
 */

const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ request, env }) {
  const filings = await readFilings(env);
  const tally = await readTally(env);

  let signedIn = false;
  let username = null;
  let avatar = null;
  let mine = {};

  const user = await currentUser(request, env);
  if (user) {
    signedIn = true;
    username = user.u;
    avatar = user.a || null;
    mine = await readMarks(env, user.id);
  }

  const pending = filings.reduce((n, e) => n + (e.h ? 0 : 1), 0);

  return json({
    contract: env.CONTRACT || "",
    live: isLive(env),
    total: filings.length,
    pending,
    items: filings.slice(-500).map(publicEntry),
    tally,
    mine,
    signedIn,
    username,
    avatar,
  });
}
