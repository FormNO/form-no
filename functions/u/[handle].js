import { currentUser } from "../../lib/session.js";
import { readFilings, readTally, readMarks, readHidden } from "../../lib/store.js";

/**
 * GET /u/<handle>
 * Everything one account has filed, newest first.
 *
 * Filings are tied to the X account id, not to the handle, so somebody who
 * renames keeps their whole record and old links still resolve. Each message
 * keeps the handle it was written under, because that is what goes on chain.
 */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const when = (t) =>
  new Date(t * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const STYLE = `
:root{--paper:#d6cbb0;--card:#e8e1cb;--ink:#16150f;--stamp:#b32218;--blue:#24356b;--rule:rgba(22,21,15,.28);--rule-soft:rgba(22,21,15,.14)}
*{box-sizing:border-box}
html{background:#d6cbb0;color-scheme:light only}
html,body{margin:0;padding:0;min-height:100%}
body{background:#d6cbb0;color:#16150f;font-family:"Courier Prime",ui-monospace,monospace;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.sheet{max-width:560px;margin:0 auto;padding:0 16px 48px;min-height:100vh}
.masthead{padding:16px 0 12px;border-bottom:1.5px solid var(--ink)}
.file-no{font-size:11px;opacity:.7}
.mark{margin:8px 0 0}
.mark span{position:relative;display:inline-block;font-family:"Archivo Black",system-ui,sans-serif;font-size:clamp(40px,11vw,60px);line-height:.85;letter-spacing:-.045em;color:var(--stamp)}
.mark span::after{content:"";position:absolute;left:-.02em;right:-.06em;top:52%;height:.06em;background:var(--stamp);transform:rotate(-3.2deg);transform-origin:left center}
.card{margin:16px 0 0;padding:14px;background:var(--card);border:1.5px solid var(--ink);box-shadow:3px 3px 0 rgba(22,21,15,.18)}
.id{display:flex;gap:12px;align-items:center}
.id img{width:54px;height:54px;border:1.5px solid var(--ink);object-fit:cover;background:var(--paper)}
.handle{font-size:19px;font-weight:700;margin:0}
.sub{margin:3px 0 0;font-size:11.5px;opacity:.7}
.stats{display:flex;gap:18px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--rule);font-size:11.5px}
.stats b{display:block;font-family:"Archivo Black",sans-serif;font-size:19px;line-height:1.1;letter-spacing:-.02em}
.stats span{opacity:.7}
.links{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.links a{flex:1;min-width:130px;text-align:center;text-decoration:none;border:1.5px solid var(--ink);padding:8px 6px;font-size:12px;font-weight:700;color:var(--ink)}
.links a.primary{background:var(--ink);color:var(--card)}
h2{margin:24px 0 0;padding-bottom:6px;border-bottom:1.5px solid var(--ink);font-size:14px}
.entry{padding:12px 0;border-bottom:1px solid var(--rule-soft)}
.entry-top{display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:4px}
.entry-top a{color:var(--blue);text-decoration:none;border-bottom:1px solid rgba(36,53,107,.4)}
.seq{color:var(--stamp);font-weight:700}
.as{opacity:.6}
.entry p{margin:0;font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.entry p::before{content:"\\201C"}.entry p::after{content:"\\201D"}
.counts{margin-top:6px;font-size:11px;opacity:.65}
.queued{color:var(--stamp)}
.empty{padding:22px 0;font-size:12.5px;opacity:.7}
.note{margin-top:22px;padding-top:12px;border-top:1px dashed var(--rule);font-size:11px;opacity:.6;line-height:1.5}
.note a{color:var(--blue)}
`;

function shell(title, desc, site, body, canonical) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(site)}/share.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(canonical)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<main class="sheet">
  <header class="masthead">
    <div class="file-no">Base Mainnet &middot; Form N-O</div>
    <div class="mark"><span>NO</span></div>
  </header>
${body}
</main>
</body>
</html>`;
}

function missing(site, raw) {
  return new Response(
    shell(
      "Unknown account — Form N-O",
      "Nothing has been filed under that handle.",
      site,
      `<div class="card"><p class="handle">Unknown account</p><p class="sub">Nothing has been filed under that handle.</p><div class="links"><a class="primary" href="/">Go to the wall</a></div></div>`,
      site + "/u/" + encodeURIComponent(raw)
    ),
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function onRequestGet({ params, request, env }) {
  const site = env.SITE_URL || "";
  const raw = String(params.handle || "").replace(/^@/, "");

  if (!/^[A-Za-z0-9_]{1,20}$/.test(raw)) return missing(site, raw);

  const asked = raw.toLowerCase();

  let accountId = null;
  let record = null;

  if (env.RATE) {
    accountId = await env.RATE.get("handle:" + asked);
    if (accountId) {
      try {
        record = JSON.parse((await env.RATE.get("user:" + accountId)) || "null");
      } catch {
        record = null;
      }
    }
  }

  const filings = await readFilings(env);
  const hidden = await readHidden(env);

  // An account id is the truth. Only fall back to matching the handle when
  // this handle has never signed in, so a released handle cannot inherit
  // somebody else's record.
  const mineList = accountId
    ? filings.filter((e) => String(e.aid) === String(accountId))
    : filings.filter((e) => String(e.u).toLowerCase() === asked);

  const visible = mineList
    .filter((e) => !hidden.has(e.id) && !(e.h && hidden.has(e.h)))
    .sort((a, b) => b.seq - a.seq);

  if (!visible.length && !record) return missing(site, raw);

  const display = (record && record.u) || (visible[0] && visible[0].u) || raw;
  const avatar = (record && record.avatar) || "";
  const canonical = site + "/u/" + display;

  const tally = await readTally(env);

  const viewer = await currentUser(request, env);
  const isSelf =
    viewer && accountId && String(viewer.id) === String(accountId);

  let signedCount = null;
  if (isSelf) {
    const marks = await readMarks(env, viewer.id);
    signedCount = Object.values(marks).filter((v) => v === "sign").length;
  }

  const totalSigned = visible.reduce(
    (sum, e) => sum + ((tally[e.id] && tally[e.id].s) || 0),
    0
  );

  const renamed =
    record && String(record.u).toLowerCase() !== asked
      ? `<p class="sub">Previously @${esc(raw)}</p>`
      : "";

  const stats =
    `<div class="stats">` +
    `<div><b>${visible.length}</b><span>filed</span></div>` +
    `<div><b>${totalSigned}</b><span>signatures received</span></div>` +
    (signedCount === null
      ? ""
      : `<div><b>${signedCount}</b><span>you have signed</span></div>`) +
    `</div>`;

  const list = visible.length
    ? visible
        .map((e) => {
          const t = tally[e.id] || { s: 0, n: 0 };
          const under =
            String(e.u).toLowerCase() !== String(display).toLowerCase()
              ? ` <span class="as">as @${esc(e.u)}</span>`
              : "";
          const queued = e.h ? "" : ` &middot; <span class="queued">waiting for the chain</span>`;
          return `<article class="entry">
  <div class="entry-top">
    <span><span class="seq">#${String(e.seq).padStart(4, "0")}</span>${under}</span>
    <a href="/r/${esc(e.id)}">${esc(when(e.t))}</a>
  </div>
  <p>${esc(e.m)}</p>
  <div class="counts">Signed by ${t.s} &middot; Objected by ${t.n}${queued}</div>
</article>`;
        })
        .join("")
    : `<div class="empty">${
        isSelf ? "You have not filed anything yet." : "Nothing filed under this handle yet."
      }</div>`;

  const body = `
  <div class="card">
    <div class="id">
      ${avatar ? `<img src="${esc(avatar)}" alt="" width="54" height="54" loading="lazy">` : ""}
      <div>
        <p class="handle">@${esc(display)}</p>
        <p class="sub">${isSelf ? "This is your record." : "Filed on Form N-O"}</p>
        ${renamed}
      </div>
    </div>
    ${stats}
    <div class="links">
      <a class="primary" href="/">${isSelf ? "File today's" : "Go to the wall"}</a>
      <a href="https://x.com/${esc(display)}" target="_blank" rel="noopener">@${esc(display)} on X</a>
    </div>
  </div>

  <h2>Filed</h2>
  ${list}

  <p class="note">Filings are written to Base as event logs, where they cannot be edited or removed. The handle comes from the X account that signed in, and each message keeps the handle it was written under. This project did not write these messages, does not endorse them, and takes no responsibility for their content. <a href="/">Form N-O</a></p>`;

  const desc = visible.length
    ? `${visible.length} filed on Form N-O. Latest: ${visible[0].m}`
    : `Nothing filed under @${display} yet.`;

  return new Response(shell("@" + display + " — Form N-O", desc, site, body, canonical), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": isSelf ? "no-store" : "public, max-age=60",
    },
  });
}
