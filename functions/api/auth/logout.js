import { cookieHeader, COOKIE } from "../../../lib/session.js";

/**
 * POST /api/auth/logout
 */
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieHeader(COOKIE, "", 0),
    },
  });
}
