/**
 * Retry utility with exponential backoff and jitter.
 *
 * Mirrors the TS `retryWithOptions`: exponential backoff
 * `baseDelay * 2^(attempt-1)`, 25% jitter, capped at `maxDelay`.
 */

use std::time::Duration;

/// Default retry configuration (matches TS DEFAULT_OPTIONS).
const DEFAULT_MAX_ATTEMPTS: usize = 3;
const DEFAULT_BASE_DELAY: u64 = 1000;
const DEFAULT_MAX_DELAY: u64 = 30_000;

/// Retry configuration options.
#[derive(Debug, Clone)]
pub struct RetryOptions {
    pub max_attempts: usize,
    pub base_delay: u64,
    pub max_delay: u64,
}

impl Default for RetryOptions {
    fn default() -> Self {
        RetryOptions {
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            base_delay: DEFAULT_BASE_DELAY,
            max_delay: DEFAULT_MAX_DELAY,
        }
    }
}

/// Calculate delay with exponential backoff + 25% jitter.
///
/// Formula: `min(baseDelay * 2^(attempt-1) + jitter * 0.25, maxDelay)`
///
/// `jitter` is a value in [0, 1) representing the random component.
/// Passing a fixed jitter makes this deterministic for testing.
pub fn calculate_delay(attempt: usize, base_delay: u64, max_delay: u64, jitter: f64) -> u64 {
    let exp = (base_delay as f64) * (2.0_f64).powi(attempt as i32 - 1);
    let jitter_amount = jitter * exp * 0.25;
    let total = exp + jitter_amount;
    total.min(max_delay as f64) as u64
}

/// Retry an async function with exponential backoff and jitter.
pub async fn retry_with_options<T, F, Fut>(
    mut operation: F,
    options: Option<RetryOptions>,
) -> anyhow::Result<T>
where
    F: FnMut() -> Fut + Send + Sync,
    Fut: std::future::Future<Output = anyhow::Result<T>> + Send,
{
    let opts = options.unwrap_or_default();
    let mut last_error: Option<anyhow::Error> = None;

    for attempt in 1..=opts.max_attempts {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = Some(e);
                if attempt >= opts.max_attempts {
                    break;
                }
                let jitter: f64 = rand::random();
                let delay = calculate_delay(attempt, opts.base_delay, opts.max_delay, jitter);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("All retry attempts failed")))
}

/// Convenience: retry with default options.
pub async fn retry<T, F, Fut>(operation: F) -> anyhow::Result<T>
where
    F: FnMut() -> Fut + Send + Sync,
    Fut: std::future::Future<Output = anyhow::Result<T>> + Send,
{
    retry_with_options(operation, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_delay_exponential_backoff() {
        // attempt 1: 100 * 2^0 = 100
        assert_eq!(calculate_delay(1, 100, 10_000, 0.0), 100);
        // attempt 2: 100 * 2^1 = 200
        assert_eq!(calculate_delay(2, 100, 10_000, 0.0), 200);
        // attempt 3: 100 * 2^2 = 400
        assert_eq!(calculate_delay(3, 100, 10_000, 0.0), 400);
    }

    #[test]
    fn calculate_delay_with_jitter() {
        // 50% jitter: 100 + 0.5 * 100 * 0.25 = 112.5 → 112
        assert_eq!(calculate_delay(1, 100, 10_000, 0.5), 112);
    }

    #[test]
    fn calculate_delay_capped_at_max() {
        assert_eq!(calculate_delay(1, 10_000, 500, 0.0), 500);
        assert_eq!(calculate_delay(5, 1000, 2000, 0.0), 16000.min(2000));
    }

    #[test]
    fn calculate_delay_zero_base() {
        // base_delay=0, jitter doesn't matter: 0
        assert_eq!(calculate_delay(1, 0, 10_000, 0.5), 0);
    }

    #[test]
    fn retry_succeeds_first_attempt() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut calls = 0;
            let result = retry_with_options(
                || {
                    calls += 1;
                    async move { Ok::<_, anyhow::Error>(1) }
                },
                Some(RetryOptions::default()),
            ).await;
            assert_eq!(result.unwrap(), 1);
            assert_eq!(calls, 1);
        });
    }

    #[test]
    fn retry_succeeds_after_failures() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut attempts = 0;
            let result = retry_with_options(
                || {
                    attempts += 1;
                    async move {
                        if attempts < 3 {
                            Err(anyhow::anyhow!("fail"))
                        } else {
                            Ok::<_, anyhow::Error>("success")
                        }
                    }
                },
                Some(RetryOptions { max_attempts: 5, base_delay: 1, max_delay: 10, ..Default::default() }),
            ).await;
            assert_eq!(result.unwrap(), "success");
            assert_eq!(attempts, 3);
        });
    }

    #[test]
    fn retry_throws_after_max_attempts() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut attempts = 0;
            let result = retry_with_options(
                || {
                    attempts += 1;
                    async move { Err::<(), _>(anyhow::anyhow!("permanent")) }
                },
                Some(RetryOptions { max_attempts: 2, base_delay: 1, max_delay: 5, ..Default::default() }),
            ).await;
            assert!(result.is_err());
            assert_eq!(attempts, 2);
        });
    }

    #[test]
    fn retry_max_attempts_one() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut attempts = 0;
            let result = retry_with_options(
                || {
                    attempts += 1;
                    async move { Err::<(), _>(anyhow::anyhow!("fail")) }
                },
                Some(RetryOptions { max_attempts: 1, base_delay: 0, max_delay: 0, ..Default::default() }),
            ).await;
            assert!(result.is_err());
            assert_eq!(attempts, 1);
        });
    }
}
