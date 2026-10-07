/**
 * Session handling for Form N-O.
 *
 * After someone signs in with X we store their handle in a signed cookie.
 * Nothing is looked up again on later visits, so X is called exactly once
 * per sign-in and never once per page view.
 */

const COOKIE = "fno_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return body + "." + b64url(sig);
}

export async function verifySession(token, secret) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      unb64url(sig),
      enc.encode(body)
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(unb64url(body)));
  } catch {
    return null;
  }
  if (!data || !data.id || !data.u) return null;
  if (data.exp && Date.now() / 1000 > data.exp) return null;
  return data;
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookieHeader(name, value, maxAge) {
  const bits = [
    name + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=" + maxAge,
  ];
  return bits.join("; ");
}

export async function currentUser(request, env) {
  if (!env.SESSION_SECRET) return null;
  return verifySession(readCookie(request, COOKIE), env.SESSION_SECRET);
}

export { COOKIE, MAX_AGE, b64url };
