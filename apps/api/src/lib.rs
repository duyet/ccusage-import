use serde::Deserialize;
use worker::*;

mod analytics;
mod auth;
mod sinks;
mod types;

use analytics::{analytics_window, load_points, summarize};
use auth::{
    auth_error_response, is_owner_account, list_api_keys, mint_api_key, opt_var, require_api_key,
    require_session, revoke_api_key,
};
use sinks::{collect_pings, fanout_write};
use types::{
    ch_now, cors_allow_origin, ingest_status_code, ping_ok, sha256_hex16, IngestBody, VERSION,
};

#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let origin = req.headers().get("Origin").ok().flatten();
    let method = req.method();
    if method == Method::Options {
        return apply_cors(origin.as_deref(), true, Response::empty()?.with_status(204));
    }
    let public = matches!(req.path().as_str(), "/" | "/health" | "/ping");
    match route(req, env).await {
        Ok(res) => apply_cors(origin.as_deref(), public, res),
        Err(e) => {
            let res = Response::from_json(&serde_json::json!({"error": e.to_string()}))?
                .with_status(500);
            apply_cors(origin.as_deref(), public, res)
        }
    }
}

async fn route(req: Request, env: Env) -> Result<Response> {
    let path = req.path();
    let method = req.method();
    match (method, path.as_str()) {
        (Method::Get, "/") => {
            let html = dashboard_html(&opt_var(&env, "CLERK_PUBLISHABLE_KEY"), VERSION);
            Response::from_html(html)
        }
        (Method::Get, "/health") => Response::from_json(&serde_json::json!({
            "ok": true,
            "service": "summa",
            "version": VERSION,
        })),
        (Method::Get, "/ping") => {
            let samples = collect_pings(&env).await;
            Response::from_json(&serde_json::json!({
                "ok": ping_ok(&samples),
                "samples": samples,
            }))
        }
        (Method::Get, "/status") => status(req, env).await,
        (Method::Post, "/v1/ingest") => ingest(req, env).await,
        (Method::Get, "/v1/analytics") => analytics(req, env, false).await,
        (Method::Get, "/v1/analytics/summary") => analytics(req, env, true).await,
        (Method::Post, "/v1/keys") => create_key(req, env).await,
        (Method::Get, "/v1/keys") => list_keys(req, env).await,
        (Method::Delete, p) if p.starts_with("/v1/keys/") => {
            let id = p.trim_start_matches("/v1/keys/");
            delete_key(req, env, id).await
        }
        _ => Response::from_json(&serde_json::json!({"error": "not found"}))
            .map(|r| r.with_status(404)),
    }
}

async fn status(req: Request, env: Env) -> Result<Response> {
    let auth = match require_api_key(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let samples = collect_pings(&env).await;
    Response::from_json(&serde_json::json!({
        "ok": ping_ok(&samples),
        "account_id": auth.account_id,
        "api_key_id": auth.api_key_id,
        "ping": samples,
    }))
}

async fn ingest(mut req: Request, env: Env) -> Result<Response> {
    let auth = match require_api_key(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let body: IngestBody = match req.json().await {
        Ok(b) => b,
        Err(_) => {
            return Response::from_json(&serde_json::json!({"error": "invalid json"}))
                .map(|r| r.with_status(400));
        }
    };
    let now = ch_now();
    let mut events = Vec::new();
    for mut e in body.events {
        e.account_id = auth.account_id.clone();
        e.api_key_id = auth.api_key_id.clone();
        if e.dedup_key.is_empty() {
            e.dedup_key = sha256_hex16(&format!(
                "{}|{}|{}|{}|{}|{}|{}",
                e.account_id, e.source, e.machine_name, e.record_type, e.date, e.model_name,
                e.record_key
            ));
        }
        if e.created_at.is_empty() {
            e.created_at = now.clone();
        }
        if e.updated_at.is_empty() {
            e.updated_at = now.clone();
        }
        events.push(e);
    }
    let sinks = fanout_write(&env, &events).await;
    let code = ingest_status_code(&sinks);
    let res = Response::from_json(&serde_json::json!({
        "accepted": events.len(),
        "sinks": sinks,
    }))?;
    Ok(res.with_status(code))
}

async fn analytics(req: Request, env: Env, summary: bool) -> Result<Response> {
    let auth = match require_api_key(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let url = req.url()?;
    let group = url
        .query_pairs()
        .find(|(k, _)| k == "group")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| "source".into());
    let days = url
        .query_pairs()
        .find(|(k, _)| k == "days")
        .and_then(|(_, v)| v.parse::<i64>().ok());
    let since = url
        .query_pairs()
        .find(|(k, _)| k == "since")
        .map(|(_, v)| v.into_owned());
    let until = url
        .query_pairs()
        .find(|(k, _)| k == "until")
        .map(|(_, v)| v.into_owned());
    let default_days = if summary { Some(days.unwrap_or(7)) } else { days };
    let (since, until) = match analytics_window(since.as_deref(), until.as_deref(), default_days) {
        Ok(w) => w,
        Err(e) => {
            return Response::from_json(&serde_json::json!({"error": e})).map(|r| r.with_status(400));
        }
    };
    let include_legacy = is_owner_account(&env, &auth.account_id).await.unwrap_or(false);
    let points = match load_points(&env, &auth.account_id, include_legacy, &group, &since, &until).await {
        Ok(p) => p,
        Err(e) => {
            return Response::from_json(&serde_json::json!({"error": e.to_string()}))
                .map(|r| r.with_status(502));
        }
    };
    if summary {
        return Response::from_json(&summarize(&since, &until, &points));
    }
    Response::from_json(&serde_json::json!({
        "since": since,
        "until": until,
        "group": group,
        "points": points,
    }))
}

#[derive(Deserialize, Default)]
struct KeyName {
    #[serde(default)]
    name: String,
}

async fn create_key(mut req: Request, env: Env) -> Result<Response> {
    let auth = match require_session(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let name = req
        .json::<KeyName>()
        .await
        .unwrap_or_default()
        .name;
    let (id, token, prefix) = mint_api_key(&env, &auth.account_id, &name).await?;
    Response::from_json(&serde_json::json!({ "id": id, "token": token, "prefix": prefix }))
}

async fn list_keys(req: Request, env: Env) -> Result<Response> {
    let auth = match require_session(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let keys = list_api_keys(&env, &auth.account_id).await?;
    Response::from_json(&serde_json::json!({
        "account_id": auth.account_id,
        "keys": keys,
    }))
}

async fn delete_key(req: Request, env: Env, id: &str) -> Result<Response> {
    let auth = match require_session(&req, &env).await {
        Ok(a) => a,
        Err(e) => return auth_error_response(e),
    };
    let ok = revoke_api_key(&env, &auth.account_id, id).await?;
    if !ok {
        return Response::from_json(&serde_json::json!({"error": "not found"}))
            .map(|r| r.with_status(404));
    }
    Response::from_json(&serde_json::json!({"ok": true, "id": id, "revoked": true}))
}

fn apply_cors(origin: Option<&str>, public: bool, res: Response) -> Result<Response> {
    let allow = cors_allow_origin(origin).or_else(|| if public { Some("*".into()) } else { None });
    let Some(allow) = allow else {
        return Ok(res);
    };
    let headers = res.headers().clone();
    let _ = headers.set("access-control-allow-origin", &allow);
    let _ = headers.set(
        "access-control-allow-headers",
        "Authorization, Content-Type, X-Summa-Token",
    );
    let _ = headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    let _ = headers.set("vary", "Origin");
    Ok(res.with_headers(headers))
}

fn dashboard_html(publishable_key: &str, version: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=utf-8><title>summa telemetry</title>\
         <meta name=viewport content=\"width=device-width,initial-scale=1\">\
         <style>body{{font:15px/1.45 system-ui,sans-serif;margin:24px;background:#f6f5f2;color:#161513}}\
         code,pre{{font:13px ui-monospace,monospace}}pre{{background:#f0eee9;padding:12px;border-radius:8px}}</style>\
         </head><body><h1>summa telemetry</h1>\
         <p>v{version} · <a href=/health>health</a> · <a href=/ping>ping</a></p>\
         <p>Hub at <code>https://summa.duyet.net</code>. Sign in with Clerk (if configured) or a bootstrap token to mint <code>summa_</code> API keys.</p>\
         <pre>[telemetry]\nendpoint = \"https://summa.duyet.net\"\n# credentials.toml telemetry_token = \"summa_…\"</pre>\
         <p class=muted>Clerk pk set: {}</p></body></html>",
        !publishable_key.is_empty()
    )
}
