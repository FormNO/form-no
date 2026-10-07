import {
  readCookie,
  cookieHeader,
  signSession,
  COOKIE,
  MAX_AGE,
} from "../../../lib/session.js";

/**
 * GET /api/auth/callback
 * Exchanges the code for a token, reads the handle once, stores it in a
 * signed cookie and throws the token away. The access token is never kept.
 *
 * Cost note: the user lookup below is the only billed X call in the whole
 * project. One per sign-in.
 *
 * Environment variables:
 *   X_CLIENT_ID, X_CLIENT_SECRET, SITE_URL, SESSION_SECRET
 */

function fail(message) {
  return new Response(
    "<!doctype html><meta charset=utf-8><body style=\"font-family:ui-monospace,monospace;background:#d6cbb0;color:#16150f;padding:40px\">" +
      "<p>" + message + "</p><p><a href=\"/\" style=\"color:#24356b\">Back to the wall</a></p>",
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) return fail("Sign-in was cancelled.");
  if (!code || !state) return fail("Sign-in did not complete.");

  let pending;
  try {
    pending = JSON.parse(readCookie(request, "fno_pending") || "null");
  } catch {
    pending = null;
  }
  if (!pending || pending.s !== state) return fail("Sign-in expired. Try again.");

  // ---- exchange the code for a token ----
  const basic = btoa(env.X_CLIENT_ID + ":" + env.X_CLIENT_SECRET);
  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + basic,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.SITE_URL + "/api/auth/callback",
      code_verifier: pending.v,
    }),
  });

  if (!tokenRes.ok) return fail("X refused the sign-in. Try again.");
  const token = await tokenRes.json();
  if (!token.access_token) return fail("X refused the sign-in. Try again.");

  // ---- read the handle and avatar, once ----
  // This single lookup is the only billed X call in the project. Asking for
  // the avatar here costs nothing extra.
  const meRes = await fetch(
    "https://api.x.com/2/users/me?user.fields=profile_image_url",
    { headers: { Authorization: "Bearer " + token.access_token } }
  );

  if (!meRes.ok) return fail("Could not read your X profile. Try again.");
  const me = await meRes.json();
  const user = me && me.data;
  if (!user || !user.id || !user.username) {
    return fail("Could not read your X profile. Try again.");
  }

  // X serves a small thumbnail by default; ask for the larger file
  const avatar = String(user.profile_image_url || "").replace("_normal.", "_400x400.");

  // Remember who this account is, so a later handle change does not orphan
  // anything they have already filed.
  if (env.RATE) {
    const key = "user:" + user.id;
    let record = {};
    try {
      record = JSON.parse((await env.RATE.get(key)) || "{}");
    } catch {
      record = {};
    }

    const past = Array.isArray(record.past) ? record.past : [];
    if (record.u && record.u !== user.username && past.indexOf(record.u) < 0) {
      past.push(record.u);
    }

    await env.RATE.put(
      key,
      JSON.stringify({ u: user.username, avatar, past })
    );
    await env.RATE.put("handle:" + user.username.toLowerCase(), user.id);
    for (const old of past) {
      await env.RATE.put("handle:" + old.toLowerCase(), user.id);
    }
  }

  const session = await signSession(
    {
      id: user.id,
      u: user.username,
      a: avatar,
      exp: Math.floor(Date.now() / 1000) + MAX_AGE,
    },
    env.SESSION_SECRET
  );

  // "//evil.example" also starts with a slash, so check for it explicitly
  const asked = typeof pending.b === "string" ? pending.b : "/";
  const back = asked.startsWith("/") && !asked.startsWith("//") ? asked : "/";

  const headers = new Headers({ Location: back });
  headers.append("Set-Cookie", cookieHeader(COOKIE, session, MAX_AGE));
  headers.append("Set-Cookie", cookieHeader("fno_pending", "", 0));

  return new Response(null, { status: 302, headers });
}
