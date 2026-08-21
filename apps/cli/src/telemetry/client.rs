//! Cloud hub client (`https://summa.duyet.net`). Replaces local `summa serve`.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;

use crate::model::{DataSink, EventsSnapshotData, SinkResult};
use crate::telemetry::{prepare_events, IngestResponse};

pub const DEFAULT_ENDPOINT: &str = "https://summa.duyet.net";
pub const INGEST_CHUNK: usize = 400;

pub struct TelemetrySink {
    endpoint: String,
    token: String,
    client: Option<reqwest::Client>,
}

impl TelemetrySink {
    pub fn new(endpoint: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into().trim_end_matches('/').to_string(),
            token: token.into(),
            client: None,
        }
    }

    pub fn from_parts(endpoint: Option<&str>, token: Option<&str>) -> Option<Self> {
        let token = token.map(str::trim).filter(|s| !s.is_empty())?;
        let endpoint = endpoint
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_ENDPOINT);
        Some(Self::new(endpoint, token))
    }
}

#[async_trait]
impl DataSink for TelemetrySink {
    fn name(&self) -> &'static str {
        "summa-cloud"
    }

    async fn connect(&mut self) -> anyhow::Result<()> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;
        let url = format!("{}/health", self.endpoint);
        let resp = client.get(&url).send().await?.error_for_status()?;
        let _ = resp.bytes().await?;
        self.client = Some(client);
        Ok(())
    }

    async fn write(&mut self, data: EventsSnapshotData) -> anyhow::Result<SinkResult> {
        let start = Instant::now();
        let events = prepare_events(data.events);
        if events.is_empty() {
            return Ok(SinkResult {
                sink_name: self.name().to_string(),
                duration_ms: start.elapsed().as_millis() as u64,
                ..SinkResult::default()
            });
        }
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("telemetry sink not connected"))?;
        let url = format!("{}/v1/ingest", self.endpoint);
        let mut accepted = 0u64;
        for chunk in events.chunks(INGEST_CHUNK) {
            let resp = client
                .post(&url)
                .bearer_auth(&self.token)
                .header("X-Summa-Token", &self.token)
                .json(&serde_json::json!({ "events": chunk }))
                .send()
                .await?
                .error_for_status()?;
            let body: IngestResponse = resp.json().await.unwrap_or(IngestResponse {
                accepted: chunk.len(),
                sinks: Vec::new(),
            });
            accepted += body.accepted as u64;
        }
        let mut rows_written = HashMap::new();
        rows_written.insert("ccusage_events".into(), accepted);
        Ok(SinkResult {
            sink_name: self.name().to_string(),
            tables_written: vec!["ccusage_events".into()],
            rows_written,
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        })
    }

    async fn close(&mut self) -> anyhow::Result<()> {
        self.client = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_parts_requires_token() {
        assert!(TelemetrySink::from_parts(Some(DEFAULT_ENDPOINT), None).is_none());
        assert!(TelemetrySink::from_parts(Some(DEFAULT_ENDPOINT), Some("")).is_none());
        let s = TelemetrySink::from_parts(None, Some("summa_abc")).unwrap();
        assert_eq!(s.endpoint, DEFAULT_ENDPOINT);
        assert_eq!(s.name(), "summa-cloud");
    }

    #[test]
    fn strips_trailing_slash() {
        let s = TelemetrySink::new("https://summa.duyet.net/", "t");
        assert_eq!(s.endpoint, "https://summa.duyet.net");
    }

    #[test]
    fn ingest_chunks_stay_under_worker_cap() {
        assert!(INGEST_CHUNK <= 500);
        assert!(INGEST_CHUNK >= 100);
    }
}
