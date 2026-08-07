use crate::model::{DataSource, EventsSnapshotData, SourceResult};
use crate::parser::rows::build_companion_event_rows;
use async_trait::async_trait;

/// Configuration for a companion source (codex, opencode, etc.).
#[derive(Debug)]
pub struct CompanionSourceOptions {
    /// Which ccusage agent subcommand to fetch (e.g. `codex`, `opencode`).
    pub source: crate::fetcher::companion::CompanionSource,
    pub machine_name: String,
    pub hash_projects: bool,
    pub timeout_ms: Option<u64>,
    pub verbose: Option<bool>,
    pub data_path: Option<String>,
    pub since: Option<String>,
    pub end_date: Option<String>,
    pub import_id: String,
}

/// A companion data source that fetches from ccusage agent subcommands.
pub struct CompanionSource {
    opts: CompanionSourceOptions,
}

impl CompanionSource {
    pub fn new(opts: CompanionSourceOptions) -> Self {
        Self { opts }
    }
}

#[async_trait]
impl DataSource for CompanionSource {
    fn name(&self) -> &'static str {
        self.opts.source.as_str()
    }

    async fn fetch(&self) -> anyhow::Result<SourceResult> {
        use crate::fetcher::companion::{fetch_all_companion_data, CompanionFetchOptions};

        let CompanionSourceOptions {
            source,
            machine_name,
            hash_projects,
            timeout_ms,
            verbose,
            data_path,
            since,
            end_date,
            import_id,
        } = &self.opts;

        let fetch_opts = CompanionFetchOptions {
            timeout_ms: *timeout_ms,
            max_retries: Some(2),
            verbose: *verbose,
            data_path: data_path.clone(),
            since: since.clone(),
            end_date: end_date.clone(),
        };

        let raw = fetch_all_companion_data(*source, fetch_opts).await?;

        let source_str = source.as_str().to_string();
        let events = build_companion_event_rows(
            &raw,
            machine_name,
            &source_str,
            *hash_projects,
            import_id,
        );

        Ok(SourceResult {
            source_name: self.name().to_string(),
            data: EventsSnapshotData { events },
            error: None,
            fetched_at: chrono::Utc::now().to_rfc3339(),
        })
    }
}
