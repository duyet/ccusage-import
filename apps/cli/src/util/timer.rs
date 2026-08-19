/**
 * Promise timeout helper shared across fetchers.
 *
 * Mirrors the TS `withTimeout`: race a future against a timer; if the timer
 * wins, invoke `on_timeout` (e.g. to kill a subprocess) before rejecting.
 */

use std::future::Future;
use std::time::Duration;

/// Result of the inner future when it wins the race.
pub type TimeoutResult<T> = Result<T, TimeoutError>;

/// Error returned when the timeout fires.
#[derive(Debug, thiserror::Error)]
#[error("Command timed out after {timeout_ms}ms")]
pub struct TimeoutError {
    pub timeout_ms: u64,
}

/// Race `future` against `timeout_ms`; if the timer fires first, call
/// `on_timeout` then return `Err(TimeoutError)`.
pub async fn with_timeout<T, F>(
    future: impl Future<Output = T> + Send,
    timeout_ms: u64,
    on_timeout: F,
) -> TimeoutResult<T>
where
    F: FnOnce() + Send,
{
    let dur = Duration::from_millis(timeout_ms);
    tokio::select! {
        // Bias toward the timer — we want prompt cleanup on timeout.
        biased;
        _ = tokio::time::sleep(dur) => {
            on_timeout();
            Err(TimeoutError { timeout_ms })
        }
        result = future => {
            Ok(result)
        }
    }
}

/// Simple sleep-based timeout (for non-critical use).
pub async fn sleep_timeout<T>(
    future: impl Future<Output = anyhow::Result<T>> + Send,
    timeout_ms: u64,
) -> anyhow::Result<T> {
    tokio::time::timeout(Duration::from_millis(timeout_ms), future)
        .await
        .map_err(|_| anyhow::anyhow!("Timed out after {}ms", timeout_ms))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn returns_value_when_future_completes_first() {
        let result = with_timeout(async { 42 }, 5_000, || {}).await.unwrap();
        assert_eq!(result, 42);
    }

    #[tokio::test]
    async fn fires_timeout_when_future_is_slow() {
        let mut called = false;
        let result = with_timeout(
            async {
                tokio::time::sleep(Duration::from_millis(500)).await;
                99
            },
            50,
            || called = true,
        ).await;
        assert!(result.is_err());
        assert!(called, "on_timeout was not called");
        assert_eq!(result.unwrap_err().timeout_ms, 50);
    }

    #[tokio::test]
    async fn sleep_timeout_returns_error_on_timeout() {
        let result = sleep_timeout(
            async {
                tokio::time::sleep(Duration::from_millis(500)).await;
                Ok::<_, anyhow::Error>(1)
            },
            50,
        ).await;
        assert!(result.is_err());
    }
}
