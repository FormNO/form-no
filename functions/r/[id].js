import { readFilings, readTally, readHidden, isLive } from "../../lib/store.js";

/**
 * GET /r/<id>
 * A page of its own for a single filing, so a shared link opens that entry
 * rather than the top of the wall. Rendered on the server so the preview card
 * carries the message.
 */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Rendered on the server, so UTC. The script at the foot of the page rewrites
// it to the reader's own clock, which is what the wall already shows.
const when = (t) =>
  new Date(t * 1000).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

const LOCALISE = `<script>
(function(){
  var f={long:{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false},
         short:{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}};
  var n=document.querySelectorAll("time[datetime]");
  for(var i=0;i<n.length;i++){
    var d=new Date(n[i].getAttribute("datetime"));
    if(isNaN(d.getTime()))continue;
    try{n[i].textContent=d.toLocaleString("en-GB",f[n[i].getAttribute("data-fmt")]||f.short);}catch(e){}
  }
})();
</script>`;

const STYLE = `
:root{--paper:#d6cbb0;--card:#e8e1cb;--ink:#16150f;--stamp:#b32218;--blue:#24356b;--rule:rgba(22,21,15,.28)}
*{box-sizing:border-box}
html{background:#c3b696;color-scheme:light only}
html,body{margin:0;padding:0;min-height:100%}
body{background:#c3b696;color:#16150f;font-family:"Courier Prime",ui-monospace,monospace;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.sheet{max-width:560px;margin:0 auto;padding:0 16px 48px;min-height:100vh;background:#d6cbb0;box-shadow:0 0 0 1px rgba(22,21,15,.10),0 2px 24px rgba(22,21,15,.13)}
.masthead{padding:16px 0 12px;border-bottom:1.5px solid var(--ink)}
.file-no{font-size:11px;opacity:.7}
.mark{margin:8px 0 0}
.mark span{position:relative;display:inline-block;font-family:"Archivo Black","Arial Black","Helvetica Neue",Impact,system-ui,sans-serif;font-weight:900;font-synthesis-weight:none;font-size:clamp(40px,11vw,60px);line-height:.85;letter-spacing:-.045em;color:var(--stamp)}
.mark span::after{content:"";position:absolute;left:-.02em;right:-.06em;top:52%;height:.06em;background:var(--stamp);transform:rotate(-3.2deg);transform-origin:left center}
.filing{margin:16px 0 0;padding:16px 15px;background:var(--card);border:1.5px solid var(--ink);box-shadow:3px 3px 0 rgba(22,21,15,.18)}
.meta{display:flex;justify-content:space-between;gap:10px;font-size:11px;padding-bottom:9px;margin-bottom:11px;border-bottom:1px dashed var(--rule)}
.meta .seq{color:var(--stamp);font-weight:700}
.meta a.who{color:var(--ink);text-decoration:none;font-weight:700;border-bottom:1px solid var(--rule)}
blockquote{margin:0;font-size:18px;line-height:1.4;overflow-wrap:anywhere}
blockquote::before{content:"\\201C"}blockquote::after{content:"\\201D"}
.counts{margin-top:12px;padding-top:10px;border-top:1px dashed var(--rule);font-size:11.5px;opacity:.75}
.queued{margin-top:10px;padding:8px 10px;border:1.5px solid var(--stamp);font-size:11.5px;line-height:1.5}
.queued b{color:var(--stamp)}
.links{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.links a{flex:1;min-width:120px;text-align:center;text-decoration:none;border:1.5px solid var(--ink);padding:8px 6px;font-size:12px;font-weight:700;color:var(--ink)}
.links a.primary{background:var(--ink);color:var(--card)}
.note{margin-top:22px;padding-top:12px;border-top:1px dashed var(--rule);font-size:11px;opacity:.6;line-height:1.5}
.note a{color:var(--blue)}
`;

function notFound() {
  return new Response(
    `<!doctype html><meta charset=utf-8><title>Not on the wall — Form N-O</title>` +
      `<body style="font-family:ui-monospace,monospace;background:#d6cbb0;color:#16150f;padding:40px">` +
      `<p>Nothing is filed under that reference.</p>` +
      `<p><a href="/" style="color:#24356b">Go to the wall</a></p>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function onRequestGet({ params, env }) {
  const site = env.SITE_URL || "";
  const id = String(params.id || "").toLowerCase();

  if (!/^[a-f0-9]{24}$/.test(id)) return notFound();

  const filings = await readFilings(env);
  const entry = filings.find((e) => e.id === id);
  if (!entry) return notFound();

  const hidden = await readHidden(env);
  if (hidden.has(id) || (entry.h && hidden.has(entry.h))) return notFound();

  const tally = await readTally(env);
  const counts = tally[id] || { s: 0, n: 0 };

  const url = site + "/r/" + id;
  const title = "@" + entry.u + " refuses — Form N-O";
  const shareText = '"' + entry.m + '" — @' + entry.u + " · filed on Form N-O";

  const chainRow = entry.h
    ? `<div class="links">
      <a class="primary" href="/">File yours</a>
      <a href="https://basescan.org/tx/${esc(entry.h)}" target="_blank" rel="noopener">View on Base</a>
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">Share on X</a>
    </div>`
    : `<div class="queued"><b>Waiting for the chain.</b> This filing is in the queue. It goes on Base, in the order it was filed, when the wall opens${isLive(env) ? " — the next batch is on its way" : ""}.</div>
    <div class="links">
      <a class="primary" href="/">File yours</a>
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">Share on X</a>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(title)}</title>
<meta name="description" content="${esc(entry.m)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(entry.m)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(site)}/share.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@FormNO_">
<link rel="canonical" href="${esc(url)}">
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

  <section class="filing">
    <div class="meta">
      <span><span class="seq">#${String(entry.seq).padStart(4, "0")}</span> &nbsp;<a class="who" href="/u/${encodeURIComponent(entry.u)}">@${esc(entry.u)}</a></span>
      <time datetime="${new Date(entry.t * 1000).toISOString()}" data-fmt="long">${esc(when(entry.t))}</time>
    </div>
    <blockquote>${esc(entry.m)}</blockquote>
    <div class="counts">Signed by ${counts.s} &middot; Objected by ${counts.n}</div>
    ${chainRow}
  </section>

  <p class="note">Filings are written to Base as event logs, where they cannot be edited or removed. This one was written by a visitor signed in with X. This project did not write it, does not endorse it, and takes no responsibility for its content. <a href="/">Form N-O</a></p>
</main>
${LOCALISE}
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
