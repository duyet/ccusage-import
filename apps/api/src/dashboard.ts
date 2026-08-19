export function dashboardHtml(opts: { publishableKey: string; version: string }): string {
  const pk = JSON.stringify(opts.publishableKey);
  const version = escapeHtml(opts.version);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>summa telemetry</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f6f5f2;--ink:#161513;--muted:#5c5854;--line:#ddd8d0;--card:#fff;--ok:#0b6;--err:#c23}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:720px;margin:0 auto;padding:28px 18px 64px}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:28px 0 8px}
p{color:var(--muted)}
a{color:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:14px 0}
code,pre{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{overflow:auto;background:#f0eee9;padding:12px;border-radius:8px;margin:8px 0}
label{display:block;font-size:13px;margin:10px 0 4px;color:var(--ink)}
input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit}
button{font:inherit;border:0;border-radius:8px;padding:8px 12px;background:var(--ink);color:#fff;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.muted{color:var(--muted);font-size:13px}
.ok{color:var(--ok)} .err{color:var(--err)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
.token{word-break:break-all;background:#f0eee9;padding:10px;border-radius:8px}
#clerk-mount{min-height:40px}
.hidden{display:none}
</style>
</head>
<body>
<main>
<h1>summa telemetry</h1>
<p class="muted">v${version} · <a href="/health">health</a> · <a href="/ping">ping</a></p>
<p>Hub for ingest and analytics. Machines POST events with an API key. <a href="https://burn.duyet.net">burn.duyet.net</a> reads <code>/v1/analytics</code>.</p>
<div class="card">
<h2>CLI</h2>
<pre>[telemetry]
endpoint = "https://summa.duyet.net"
# credentials.toml telemetry_token = "summa_..."</pre>
</div>
<div class="card">
<h2>API keys</h2>
<div id="auth"></div>
<div id="panel" class="hidden">
<label>Key name</label>
<input id="kname" value="default">
<div class="row"><button id="mint" type="button">Create key</button></div>
<div id="created"></div>
<div id="list"></div>
</div>
</div>
</main>
<script>
const PK = ${pk};
const authEl = document.getElementById("auth");
const panelEl = document.getElementById("panel");
const createdEl = document.getElementById("created");
const listEl = document.getElementById("list");
let token = "";

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

async function api(path, opts) {
  const headers = Object.assign({ "content-type": "application/json" }, (opts && opts.headers) || {});
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { error: text }; }
  if (!res.ok) throw new Error((body && body.error) || (res.status + " " + res.statusText));
  return body;
}

function showCreated(created) {
  createdEl.innerHTML = '<p class="ok">Copy this token now. It is not stored in plaintext.</p>' +
    '<div class="token"><code>' + esc(created.token) + "</code></div>";
}

async function refreshKeys() {
  const body = await api("/v1/keys");
  const rows = (body.keys || []).map(function (k) {
    return "<tr><td>" + esc(k.name) + "</td><td><code>" + esc(k.prefix) + "</code></td><td>" +
      esc(k.created_at) + "</td><td>" + (k.revoked_at ? "revoked" :
      '<button class="ghost" type="button" data-id="' + esc(k.id) + '">Revoke</button>') + "</td></tr>";
  }).join("");
  listEl.innerHTML = "<table><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th></th></tr></thead><tbody>" +
    (rows || '<tr><td colspan="4" class="muted">No keys</td></tr>') + "</tbody></table>";
  listEl.querySelectorAll("button[data-id]").forEach(function (btn) {
    btn.onclick = async function () {
      await api("/v1/keys/" + btn.getAttribute("data-id"), { method: "DELETE" });
      await refreshKeys();
    };
  });
}

async function mintClick() {
  const created = await api("/v1/keys", {
    method: "POST",
    body: JSON.stringify({ name: document.getElementById("kname").value || "default" }),
  });
  showCreated(created);
  await refreshKeys();
}

function unlockPanel() {
  panelEl.classList.remove("hidden");
  document.getElementById("mint").onclick = function () {
    mintClick().catch(function (e) {
      createdEl.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
  };
}

function renderBootstrap() {
  authEl.innerHTML = '<p class="muted">No Clerk publishable key. Use the bootstrap token (Wrangler secret <code>BOOTSTRAP_TOKEN</code>) to mint the first keys.</p>' +
    '<label>Bootstrap token</label><input id="boot" type="password" autocomplete="off">';
  unlockPanel();
  const orig = mintClick;
  document.getElementById("mint").onclick = function () {
    token = document.getElementById("boot").value.trim();
    orig().catch(function (e) {
      createdEl.innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    });
  };
}

async function renderClerk() {
  authEl.innerHTML = '<div id="clerk-mount"></div><div id="clerk-msg" class="muted">Loading Clerk…</div>';
  const src = document.createElement("script");
  src.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
  src.onload = async function () {
    try {
      const Clerk = window.Clerk;
      const clerk = typeof Clerk === "function" ? new Clerk(PK) : Clerk;
      await clerk.load({ publishableKey: PK });
      const msg = document.getElementById("clerk-msg");
      if (!clerk.user) {
        msg.textContent = "";
        const mount = document.getElementById("clerk-mount");
        if (clerk.mountSignIn) clerk.mountSignIn(mount);
        else mount.innerHTML = '<p class="err">Clerk sign-in UI unavailable.</p>';
        return;
      }
      token = await clerk.session.getToken();
      msg.innerHTML = "Signed in as <strong>" + esc((clerk.user.primaryEmailAddress && clerk.user.primaryEmailAddress.emailAddress) || clerk.user.id) +
        '</strong> <button class="ghost" type="button" id="out">Sign out</button>';
      document.getElementById("out").onclick = function () { clerk.signOut(); };
      unlockPanel();
      await refreshKeys();
    } catch (e) {
      document.getElementById("clerk-msg").innerHTML = '<span class="err">' + esc(e.message) + "</span>";
    }
  };
  src.onerror = function () {
    document.getElementById("clerk-msg").innerHTML = '<span class="err">Failed to load Clerk.</span>';
  };
  document.head.appendChild(src);
}

if (PK) renderClerk();
else renderBootstrap();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
