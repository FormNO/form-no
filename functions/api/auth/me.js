import { currentUser } from "../../../lib/session.js";

/**
 * GET /api/auth/me
 * Reads the signed cookie. Never calls X, so it costs nothing.
 */
export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  return new Response(
    JSON.stringify(user ? { signedIn: true, username: user.u } : { signedIn: false }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
