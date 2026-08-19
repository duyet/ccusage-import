use chrono::{Duration, Utc};
use worker::{Env, Result};

use crate::sinks::{clickhouse_configured, clickhouse_query, parse_json_each_row};
use crate::types::AnalyticsPoint;

pub fn analytics_window(
    since: Option<&str>,
    until: Option<&str>,
    days: Option<i64>,
) -> std::result::Result<(String, String), String> {
    let today = Utc::now().date_naive();
    let until_d = match until.filter(|s| !s.is_empty()) {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| format!("invalid date `{s}`"))?,
        None => today,
    };
    let since_d = match since.filter(|s| !s.is_empty()) {
        Some(s) => chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| format!("invalid date `{s}`"))?,
        None => {
            let n = days.unwrap_or(30).max(1);
            until_d - Duration::days(n - 1)
        }
    };
    if since_d > until_d {
        return Err("since is after until".into());
    }
    Ok((
        since_d.format("%Y-%m-%d").to_string(),
        until_d.format("%Y-%m-%d").to_string(),
    ))
}

pub fn inclusive_days(since: &str, until: &str) -> i64 {
    match (
        chrono::NaiveDate::parse_from_str(since, "%Y-%m-%d"),
        chrono::NaiveDate::parse_from_str(until, "%Y-%m-%d"),
    ) {
        (Ok(a), Ok(b)) => (b - a).num_days().max(0) + 1,
        _ => 1,
    }
}

pub fn summarize(
    since: &str,
    until: &str,
    points: &[AnalyticsPoint],
) -> serde_json::Value {
    let days = inclusive_days(since, until);
    let mut cost = 0.0;
    let mut total_tokens: u64 = 0;
    let mut entries: u64 = 0;
    let mut by: Vec<(String, f64, u64, u64)> = Vec::new();
    for p in points {
        cost += p.cost;
        total_tokens = total_tokens.saturating_add(p.total_tokens);
        entries = entries.saturating_add(p.entries);
        if let Some(row) = by.iter_mut().find(|s| s.0 == p.source) {
            row.1 += p.cost;
            row.2 = row.2.saturating_add(p.total_tokens);
            row.3 = row.3.saturating_add(p.entries);
        } else {
            by.push((p.source.clone(), p.cost, p.total_tokens, p.entries));
        }
    }
    by.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    serde_json::json!({
        "since": since,
        "until": until,
        "days": days,
        "cost": cost,
        "total_tokens": total_tokens,
        "entries": entries,
        "cost_per_day": if days > 0 { cost / days as f64 } else { 0.0 },
        "by_source": by.into_iter().map(|s| serde_json::json!({
            "source": s.0, "cost": s.1, "total_tokens": s.2, "entries": s.3
        })).collect::<Vec<_>>(),
    })
}

pub async fn load_points(
    env: &Env,
    account_id: &str,
    include_legacy: bool,
    group: &str,
    since: &str,
    until: &str,
) -> Result<Vec<AnalyticsPoint>> {
    if !clickhouse_configured(env) {
        return Err(worker::Error::RustError("no analytics sink configured".into()));
    }
    let extra = if group == "model" {
        "source, model_name"
    } else {
        "source, '' AS model_name"
    };
    let group_by = if group == "model" {
        "date, source, model_name"
    } else {
        "date, source"
    };
    let tenant = if include_legacy {
        format!(
            "(account_id = {} OR account_id = '')",
            crate::types::sql_literal(account_id)
        )
    } else {
        format!("account_id = {}", crate::types::sql_literal(account_id))
    };
    let sql = format!(
        "SELECT date, {extra}, sum(cost) AS cost, sum(total_tokens) AS total_tokens, sum(entries) AS entries \
         FROM ccusage_events FINAL \
         WHERE record_type = 'daily' AND date >= '{since}' AND date <= '{until}' AND {tenant} \
         GROUP BY {group_by} ORDER BY date, source FORMAT JSONEachRow"
    );
    let text = clickhouse_query(env, &sql)
        .await
        .map_err(|e| worker::Error::RustError(e))?;
    Ok(parse_json_each_row(&text))
}
