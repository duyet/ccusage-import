export interface Env {
  DB: D1Database;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY?: string;
  BOOTSTRAP_TOKEN?: string;
  CH_HOST?: string;
  CH_PORT?: string;
  CH_USER?: string;
  CH_PASSWORD?: string;
  CH_DATABASE?: string;
  CH_PROTOCOL?: string;
  MOTHERDUCK_TOKEN?: string;
  MOTHERDUCK_DATABASE?: string;
  MOTHERDUCK_SQL_URL?: string;
}

export type ApiKeyAuth = {
  kind: "api_key";
  account_id: string;
  api_key_id: string;
  name: string;
};

export type SessionAuth = {
  kind: "session";
  account_id: string;
  clerk_user_id: string | null;
  bootstrap: boolean;
  name: string;
};

export type ApiKeyListItem = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
};

type AccountRow = {
  id: string;
  clerk_user_id: string | null;
  name: string;
  created_at: string;
};

type ApiKeyRow = {
  id: string;
  account_id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  revoked_at: string | null;
};

type JwkRsa = {
  kid?: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
  use?: string;
};

const TOKEN_PREFIX = "summa_";
const KEY_BYTES = 32;
let cachedOwnerId: string | null | undefined;
let cachedJwks: { at: number; keys: JwkRsa[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

export function extractBearer(request: Request): string {
  const alt = request.headers.get("X-Summa-Token")?.trim() ?? "";
  if (alt) return alt;
  const raw = request.headers.get("Authorization")?.trim() ?? "";
  if (!raw) return "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return (m?.[1] ?? raw).trim();
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(buf));
}

export async function sha256Hex16(value: string): Promise<string> {
  return (await sha256Hex(value)).slice(0, 16);
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const ah = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a));
  const bh = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b));
  const av = new Uint8Array(ah);
  const bv = new Uint8Array(bh);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

export async function requireApiKey(request: Request, env: Env): Promise<ApiKeyAuth | Response> {
  const token = extractBearer(request);
  if (!token.startsWith(TOKEN_PREFIX)) {
    return jsonError("unauthorized", 401);
  }
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT id, account_id, name, token_prefix, created_at, revoked_at FROM api_keys WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(hash)
    .first<ApiKeyRow>();
  if (!row) return jsonError("unauthorized", 401);
  return {
    kind: "api_key",
    account_id: row.account_id,
    api_key_id: row.id,
    name: row.name,
  };
}

export async function requireSession(request: Request, env: Env): Promise<SessionAuth | Response> {
  const token = extractBearer(request);
  if (!token) return jsonError("unauthorized", 401);

  const bootstrap = env.BOOTSTRAP_TOKEN?.trim() ?? "";
  if (bootstrap && (await timingSafeEqual(token, bootstrap))) {
    const account = await ensureOwnerAccount(env, "owner");
    return {
      kind: "session",
      account_id: account.id,
      clerk_user_id: account.clerk_user_id,
      bootstrap: true,
      name: account.name,
    };
  }

  const clerk = await verifyClerk(token, env);
  if (!clerk) return jsonError("unauthorized", 401);
  const account = await ensureClerkAccount(env, clerk.userId, clerk.name);
  return {
    kind: "session",
    account_id: account.id,
    clerk_user_id: account.clerk_user_id,
    bootstrap: false,
    name: account.name,
  };
}

export async function ownerAccountId(env: Env): Promise<string | null> {
  if (cachedOwnerId !== undefined) return cachedOwnerId;
  const row = await env.DB.prepare("SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1").first<{
    id: string;
  }>();
  cachedOwnerId = row?.id ?? null;
  return cachedOwnerId;
}

export async function isOwnerAccount(env: Env, accountId: string): Promise<boolean> {
  const owner = await ownerAccountId(env);
  return owner !== null && owner === accountId;
}

export async function mintApiKey(
  env: Env,
  accountId: string,
  name: string,
): Promise<{ id: string; token: string; prefix: string }> {
  const id = crypto.randomUUID();
  const raw = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(raw);
  const token = TOKEN_PREFIX + bytesToHex(raw);
  const prefix = token.slice(0, 14);
  const tokenHash = await sha256Hex(token);
  const createdAt = new Date().toISOString();
  const keyName = sanitizeName(name);
  await env.DB.prepare(
    "INSERT INTO api_keys (id, account_id, name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, accountId, keyName, tokenHash, prefix, createdAt)
    .run();
  return { id, token, prefix };
}

export async function listApiKeys(env: Env, accountId: string): Promise<ApiKeyListItem[]> {
  const res = await env.DB.prepare(
    "SELECT id, name, token_prefix, created_at, revoked_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC",
  )
    .bind(accountId)
    .all<ApiKeyRow>();
  return (res.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  }));
}

export async function revokeApiKey(env: Env, accountId: string, keyId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL",
  )
    .bind(now, keyId, accountId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

async function ensureOwnerAccount(env: Env, name: string): Promise<AccountRow> {
  const existing = await env.DB.prepare("SELECT id, clerk_user_id, name, created_at FROM accounts ORDER BY created_at ASC LIMIT 1").first<AccountRow>();
  if (existing) {
    if (cachedOwnerId === undefined) cachedOwnerId = existing.id;
    return existing;
  }
  const account: AccountRow = {
    id: crypto.randomUUID(),
    clerk_user_id: null,
    name: sanitizeName(name),
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare("INSERT INTO accounts (id, clerk_user_id, name, created_at) VALUES (?, ?, ?, ?)").bind(
    account.id,
    account.clerk_user_id,
    account.name,
    account.created_at,
  ).run();
  cachedOwnerId = account.id;
  return account;
}

async function ensureClerkAccount(env: Env, clerkUserId: string, name: string): Promise<AccountRow> {
  const existing = await env.DB.prepare(
    "SELECT id, clerk_user_id, name, created_at FROM accounts WHERE clerk_user_id = ?",
  )
    .bind(clerkUserId)
    .first<AccountRow>();
  if (existing) return existing;
  const account: AccountRow = {
    id: crypto.randomUUID(),
    clerk_user_id: clerkUserId,
    name: sanitizeName(name),
    created_at: new Date().toISOString(),
  };
  try {
    await env.DB.prepare("INSERT INTO accounts (id, clerk_user_id, name, created_at) VALUES (?, ?, ?, ?)").bind(
      account.id,
      account.clerk_user_id,
      account.name,
      account.created_at,
    ).run();
  } catch {
    const raced = await env.DB.prepare(
      "SELECT id, clerk_user_id, name, created_at FROM accounts WHERE clerk_user_id = ?",
    )
      .bind(clerkUserId)
      .first<AccountRow>();
    if (raced) return raced;
    throw new Error("failed to create account");
  }
  if (cachedOwnerId === null || cachedOwnerId === undefined) {
    cachedOwnerId = undefined;
    await ownerAccountId(env);
  }
  return account;
}

async function verifyClerk(
  token: string,
  env: Env,
): Promise<{ userId: string; name: string } | null> {
  const secret = env.CLERK_SECRET_KEY?.trim() ?? "";
  const pk = env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!secret && !pk) return null;

  if (token.split(".").length === 3) {
    const jwtUser = await verifyClerkJwt(token, env);
    if (jwtUser) return jwtUser;
  }

  if (!secret) return null;
  return verifyClerkMe(token, secret);
}

async function verifyClerkJwt(
  token: string,
  env: Env,
): Promise<{ userId: string; name: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: { kid?: string; alg?: string };
  let payload: { sub?: string; exp?: number; nbf?: number; azp?: string; email?: string; username?: string; name?: string };
  try {
    header = jsonObject(decodeJwtPart(h));
    payload = jsonObject(decodeJwtPart(p));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now) return null;
  if (typeof payload.azp === "string" && payload.azp && !azpAllowed(payload.azp)) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;

  const keys = await loadJwks(env);
  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  const tryKeys = candidates.length > 0 ? candidates : keys;
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = base64UrlToBytes(s);
  for (const jwk of tryKeys) {
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
      if (ok) {
        const name =
          str(payload.name) || str(payload.username) || str(payload.email) || "user";
        return { userId: payload.sub, name };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function verifyClerkMe(
  token: string,
  secret: string,
): Promise<{ userId: string; name: string } | null> {
  const urls = ["https://api.clerk.com/v1/me", "https://api.clerk.com/v1/users/me"];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Clerk-Secret-Key": secret,
        },
      });
      if (!res.ok) continue;
      const body: unknown = await res.json();
      const user = clerkUserFromUnknown(body);
      if (user) return user;
    } catch {
      continue;
    }
  }

  try {
    const res = await fetch("https://api.clerk.com/v1/me", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.ok) {
      const body: unknown = await res.json();
      const user = clerkUserFromUnknown(body);
      if (user) return user;
    }
  } catch {
    return null;
  }
  return null;
}

async function loadJwks(env: Env): Promise<JwkRsa[]> {
  const now = Date.now();
  if (cachedJwks && now - cachedJwks.at < JWKS_TTL_MS) return cachedJwks.keys;
  const keys: JwkRsa[] = [];
  const secret = env.CLERK_SECRET_KEY?.trim() ?? "";
  if (secret) {
    const fromBackend = await fetchJwks("https://api.clerk.com/v1/jwks", {
      Authorization: `Bearer ${secret}`,
    });
    keys.push(...fromBackend);
  }
  const frontend = clerkFrontendApi(env.CLERK_PUBLISHABLE_KEY ?? "");
  if (frontend) {
    const fromFrontend = await fetchJwks(`${frontend}/.well-known/jwks.json`);
    keys.push(...fromFrontend);
  }
  cachedJwks = { at: now, keys };
  return keys;
}

async function fetchJwks(url: string, headers?: HeadersInit): Promise<JwkRsa[]> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !("keys" in body)) return [];
    const raw = (body as { keys: unknown }).keys;
    if (!Array.isArray(raw)) return [];
    const out: JwkRsa[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.kty !== "RSA" || typeof o.n !== "string" || typeof o.e !== "string") continue;
      out.push({
        kid: typeof o.kid === "string" ? o.kid : undefined,
        kty: "RSA",
        alg: typeof o.alg === "string" ? o.alg : undefined,
        n: o.n,
        e: o.e,
        use: typeof o.use === "string" ? o.use : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function clerkFrontendApi(publishableKey: string): string | null {
  const raw = publishableKey.trim();
  if (!raw) return null;
  const stripped = raw.replace(/^pk_(test|live)_/, "");
  try {
    const decoded = atob(stripped);
    const url = decoded.split("$")[0]?.replace(/\/$/, "") ?? "";
    if (url.startsWith("https://")) return url;
  } catch {
    return null;
  }
  return null;
}

function clerkUserFromUnknown(body: unknown): { userId: string; name: string } | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const userObj =
    o.id && typeof o.id === "string"
      ? o
      : o.user && typeof o.user === "object" && o.user
        ? (o.user as Record<string, unknown>)
        : o.response && typeof o.response === "object" && o.response
          ? (o.response as Record<string, unknown>)
          : null;
  if (!userObj || typeof userObj.id !== "string") return null;
  const first = str(userObj.first_name);
  const last = str(userObj.last_name);
  const username = str(userObj.username);
  let email = "";
  if (Array.isArray(userObj.email_addresses) && userObj.email_addresses[0] && typeof userObj.email_addresses[0] === "object") {
    email = str((userObj.email_addresses[0] as Record<string, unknown>).email_address);
  }
  const name = [first, last].filter(Boolean).join(" ") || username || email || "user";
  return { userId: userObj.id, name };
}

function azpAllowed(azp: string): boolean {
  if (azp === "https://summa.duyet.net" || azp === "https://burn.duyet.net") return true;
  if (azp === "http://localhost" || azp.startsWith("http://localhost:")) return true;
  if (azp === "http://127.0.0.1" || azp.startsWith("http://127.0.0.1:")) return true;
  try {
    const host = new URL(azp).host;
    if (host.endsWith(".clerk.accounts.dev") || host === "clerk.accounts.dev") return true;
    if (host.endsWith(".clerk.com") || host === "clerk.com") return true;
  } catch {
    return false;
  }
  return false;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sanitizeName(name: string): string {
  const t = name.trim().slice(0, 80);
  return t || "default";
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJwtPart(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

function jsonObject<T>(v: unknown): T {
  if (!v || typeof v !== "object") throw new Error("jwt");
  return v as T;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
