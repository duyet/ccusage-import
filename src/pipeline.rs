use crate::model::{DataSink, DataSource, EventsSnapshotData, PipelineResult, SinkResult, SourceResult};
use crate::util::date::ch_now;
use futures::future::join_all;

pub struct ImportRunner {
    pub sources: Vec<Box<dyn DataSource>>,
    pub sinks: Vec<Box<dyn DataSink>>,
}

impl ImportRunner {
    pub async fn run(&mut self) -> anyhow::Result<PipelineResult> {
        let start = std::time::Instant::now();

        // 1. Fetch all sources in parallel; continue even if individual sources fail.
        let fetch_futures = self.sources.iter_mut().map(|s| s.fetch());
        let raw_results: Vec<anyhow::Result<SourceResult>> = join_all(fetch_futures).await;
        let mut source_results = Vec::with_capacity(raw_results.len());
        for res in raw_results {
            match res {
                Ok(r) => source_results.push(r),
                Err(e) => source_results.push(SourceResult {
                    source_name: "unknown".to_string(),
                    data: EventsSnapshotData::default(),
                    fetched_at: ch_now(),
                    error: Some(e.to_string()),
                }),
            }
        }

        // 2. Merge events from all sources
        let mut all_events = Vec::new();
        for res in &source_results {
            all_events.extend(res.data.events.clone());
        }
        let snapshot = EventsSnapshotData { events: all_events };

        // 3. Connect + write all sinks, continue on failure
        let mut sink_results = Vec::new();
        for sink in &mut self.sinks {
            let mut result = SinkResult {
                sink_name: sink.name().to_string(),
                ..SinkResult::default()
            };

            if let Err(e) = sink.connect().await {
                result.error = Some(e.to_string());
                sink_results.push(result);
                continue;
            }

            match sink.write(snapshot.clone()).await {
                Ok(write_res) => {
                    result.tables_written = write_res.tables_written;
                    result.rows_written = write_res.rows_written;
                    result.duration_ms = write_res.duration_ms;
                }
                Err(e) => {
                    result.error = Some(e.to_string());
                }
            }

            let _ = sink.close().await;
            sink_results.push(result);
        }

        let total_duration_ms = start.elapsed().as_millis() as u64;

        Ok(PipelineResult {
            sources: source_results
                .into_iter()
                .map(|r| crate::model::SourceSummary {
                    name: r.source_name,
                    rows: r.data.events.len(),
                    error: r.error,
                })
                .collect(),
            sinks: sink_results,
            total_duration_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EventRow, EventsSnapshotData};

    struct FakeSource {
        pub name: &'static str,
        pub rows: Vec<EventRow>,
        pub should_fail: bool,
    }

    #[async_trait::async_trait]
    impl DataSource for FakeSource {
        fn name(&self) -> &'static str {
            self.name
        }
        async fn fetch(&self) -> anyhow::Result<SourceResult> {
            if self.should_fail {
                anyhow::bail!("fake source failure");
            }
            Ok(SourceResult {
                source_name: self.name.to_string(),
                data: EventsSnapshotData {
                    events: self.rows.clone(),
                },
                fetched_at: "2025-01-01T00:00:00Z".to_string(),
                error: None,
            })
        }
    }

    struct FakeSink {
        pub name: &'static str,
        pub should_fail_connect: bool,
        pub should_fail_write: bool,
    }

    #[async_trait::async_trait]
    impl DataSink for FakeSink {
        fn name(&self) -> &'static str {
            self.name
        }
        async fn connect(&mut self) -> anyhow::Result<()> {
            if self.should_fail_connect {
                anyhow::bail!("fake connect failure");
            }
            Ok(())
        }
        async fn write(&mut self, _data: EventsSnapshotData) -> anyhow::Result<SinkResult> {
            if self.should_fail_write {
                anyhow::bail!("fake write failure");
            }
            Ok(SinkResult {
                sink_name: self.name.to_string(),
                tables_written: vec!["ccusage_events".to_string()],
                rows_written: [("ccusage_events".to_string(), 1)].into(),
                duration_ms: 1,
                error: None,
            })
        }
        async fn close(&mut self) -> anyhow::Result<()> {
            Ok(())
        }
    }

    fn make_row(id: &str) -> EventRow {
        EventRow {
            date: "2025-01-01".to_string(),
            record_type: "daily".to_string(),
            record_key: id.to_string(),
            source: "test".to_string(),
            machine_name: "m".to_string(),
            model_name: "m1".to_string(),
            session_id: "s".to_string(),
            project_path: "/p".to_string(),
            total_tokens: 10,
            cost: 0.5,
            dedup_key: format!("{:016x}", id.parse::<u64>().unwrap_or(0)),
            import_id: "i".to_string(),
            block_id: "b".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
            ..EventRow::default()
        }
    }

    #[tokio::test]
    async fn merges_events_from_multiple_sources() {
        let mut runner = ImportRunner {
            sources: vec![
                Box::new(FakeSource {
                    name: "src_a",
                    rows: vec![make_row("1")],
                    should_fail: false,
                }),
                Box::new(FakeSource {
                    name: "src_b",
                    rows: vec![make_row("2")],
                    should_fail: false,
                }),
            ],
            sinks: vec![],
        };

        let result = runner.run().await.unwrap();
        assert_eq!(result.sources.len(), 2);
        assert_eq!(result.sources[0].rows, 1);
        assert_eq!(result.sources[1].rows, 1);
    }

    #[tokio::test]
    async fn continues_when_source_fails() {
        let mut runner = ImportRunner {
            sources: vec![
                Box::new(FakeSource {
                    name: "ok",
                    rows: vec![make_row("1")],
                    should_fail: false,
                }),
                Box::new(FakeSource {
                    name: "fail",
                    rows: vec![],
                    should_fail: true,
                }),
            ],
            sinks: vec![],
        };

        let result = runner.run().await.unwrap();
        assert_eq!(result.sources.len(), 2);
        assert_eq!(result.sources[0].rows, 1);
        assert_eq!(result.sources[1].rows, 0);
    }

    #[tokio::test]
    async fn sink_write_failure_does_not_stop_other_sinks() {
        let mut runner = ImportRunner {
            sources: vec![Box::new(FakeSource {
                name: "src",
                rows: vec![make_row("1")],
                should_fail: false,
            })],
            sinks: vec![
                Box::new(FakeSink {
                    name: "sink_ok",
                    should_fail_connect: false,
                    should_fail_write: false,
                }),
                Box::new(FakeSink {
                    name: "sink_fail",
                    should_fail_connect: false,
                    should_fail_write: true,
                }),
            ],
        };

        let result = runner.run().await.unwrap();
        assert_eq!(result.sinks.len(), 2);
        assert!(result.sinks[0].error.is_none());
        assert!(result.sinks[1].error.is_some());
    }
}
