use crate::parser::rows::{build_ccusage_event_rows, CcusageData, CcusageFetchOptions};
use crate::util::date::ch_now;
use crate::{DataSource, EventsSnapshotData, SourceResult};
use async_trait::async_trait;

pub struct CcusageSource {
    machine_name: String,
    hash_projects: bool,
    timeout_ms: u64,
    verbose: bool,
    days_back: Option<i64>,
    since: Option<String>,
    end_date: Option<String>,
    import_id: String,
}

impl CcusageSource {
    pub fn new(opts: CcusageSourceOptions) -> Self {
        Self {
            machine_name: opts.machine_name,
            hash_projects: opts.hash_projects.unwrap_or(true),
            timeout_ms: opts.timeout.unwrap_or(120_000),
            verbose: opts.verbose.unwrap_or(false),
            days_back: opts.days_back,
            since: opts.since,
            end_date: opts.end_date,
            import_id: opts.import_id.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CcusageSourceOptions {
    pub machine_name: String,
    pub hash_projects: Option<bool>,
    pub timeout: Option<u64>,
    pub verbose: Option<bool>,
    pub days_back: Option<i64>,
    pub since: Option<String>,
    pub end_date: Option<String>,
    pub import_id: Option<String>,
}

#[async_trait]
impl DataSource for CcusageSource {
    fn name(&self) -> &'static str {
        "ccusage"
    }

    async fn fetch(&self) -> anyhow::Result<SourceResult> {
        let effective_since = if let Some(s) = &self.since {
            Some(s.clone())
        } else if let Some(days) = self.days_back {
            if days > 0 {
                let d = chrono::Utc::now() - chrono::Duration::days(days);
                Some(d.format("%Y-%m-%d").to_string())
            } else {
                None
            }
        } else {
            None
        };

        let fetch_opts = CcusageFetchOptions {
            timeout: Some(self.timeout_ms),
            max_retries: Some(2),
            verbose: Some(self.verbose),
            since: effective_since,
            end_date: self.end_date.clone(),
        };

        let raw = crate::fetcher::ccusage::fetch_all_ccusage_data(fetch_opts).await;
        let events = build_ccusage_event_rows(&raw, &self.machine_name, self.hash_projects, &self.import_id);

        Ok(SourceResult {
            source_name: self.name().to_string(),
            data: EventsSnapshotData { events },
            fetched_at: ch_now(),
            error: None,
        })
    }
}
