import { b64url, cookieHeader } from "../../../lib/session.js";

/**
 * GET /api/auth/start
 * Sends the visitor to X to authorise. PKCE verifier and CSRF state are kept
 * in a short-lived cookie, so no storage is needed for the round trip.
 *
 * Environment variables:
 *   X_CLIENT_ID   - from the X developer console
 *   SITE_URL      - https://form-no.pages.dev (no trailing slash)
 */

async function pkce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = b64url(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return { verifier, challenge: b64url(digest) };
}

export async function onRequestGet({ request, env }) {
  if (!env.X_CLIENT_ID || !env.SITE_URL) {
    return new Response("Sign-in is not configured.", { status: 500 });
  }

  const { verifier, challenge } = await pkce();

  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = b64url(stateBytes);

  const asked = new URL(request.url).searchParams.get("back") || "/";
  const back = asked.startsWith("/") && !asked.startsWith("//") ? asked : "/";

  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.X_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", env.SITE_URL + "/api/auth/callback");
  authorize.searchParams.set("scope", "users.read tweet.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const pending = JSON.stringify({ v: verifier, s: state, b: back });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookieHeader("fno_pending", pending, 600),
    },
  });
}
