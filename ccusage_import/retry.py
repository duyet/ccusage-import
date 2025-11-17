#!/usr/bin/env python3
"""
Retry logic with exponential backoff using tenacity
Provides decorators and utilities for resilient operations
"""

from functools import wraps
from typing import Callable, Optional, Type, Union

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .constants import MAX_RETRIES, RETRY_BACKOFF_FACTOR, RETRY_INITIAL_DELAY
from .exceptions import ClickHouseError, DataFetchError, RetryExhaustedError
from .logger import log


def retry_on_error(
    max_attempts: int = MAX_RETRIES,
    initial_delay: float = RETRY_INITIAL_DELAY,
    backoff: float = RETRY_BACKOFF_FACTOR,
    exceptions: tuple[Type[Exception], ...] = (Exception,),
) -> Callable:
    """
    Decorator for retrying functions with exponential backoff.

    Args:
        max_attempts: Maximum number of retry attempts
        initial_delay: Initial delay in seconds
        backoff: Exponential backoff multiplier
        exceptions: Tuple of exception types to retry on

    Returns:
        Decorated function with retry logic

    Example:
        >>> @retry_on_error(max_attempts=3, exceptions=(ConnectionError,))
        ... def fetch_data():
        ...     return requests.get("https://api.example.com/data")
    """

    def decorator(func: Callable) -> Callable:
        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(
                multiplier=backoff,
                min=initial_delay,
                max=60,  # Max 60 seconds between retries
            ),
            retry=retry_if_exception_type(exceptions),
            reraise=True,
        )
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except exceptions as e:
                log.warning(
                    f"Retry attempt for {func.__name__}",
                    error=str(e),
                    function=func.__name__,
                )
                raise

        return wrapper

    return decorator


def retry_clickhouse_operation(func: Callable) -> Callable:
    """
    Specialized retry decorator for ClickHouse operations.

    Retries on ClickHouse-specific errors with appropriate backoff.

    Example:
        >>> @retry_clickhouse_operation
        ... def insert_data(client, table, data):
        ...     return client.insert(table, data)
    """
    return retry_on_error(
        max_attempts=MAX_RETRIES,
        initial_delay=RETRY_INITIAL_DELAY,
        backoff=RETRY_BACKOFF_FACTOR,
        exceptions=(ClickHouseError,),
    )(func)


def retry_data_fetch(func: Callable) -> Callable:
    """
    Specialized retry decorator for data fetching operations.

    Retries on data fetch errors with appropriate backoff.

    Example:
        >>> @retry_data_fetch
        ... def fetch_ccusage_data(command):
        ...     return subprocess.run(['ccusage', command], ...)
    """
    return retry_on_error(
        max_attempts=MAX_RETRIES,
        initial_delay=RETRY_INITIAL_DELAY,
        backoff=RETRY_BACKOFF_FACTOR,
        exceptions=(DataFetchError,),
    )(func)


class CircuitBreaker:
    """
    Circuit breaker pattern implementation.

    Prevents cascading failures by stopping calls to failing services.

    States:
        - CLOSED: Normal operation
        - OPEN: Failing, reject all calls
        - HALF_OPEN: Testing if service recovered

    Example:
        >>> breaker = CircuitBreaker(threshold=5, timeout=60)
        >>> @breaker
        ... def call_external_api():
        ...     return requests.get("https://api.example.com")
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        expected_exception: Type[Exception] = Exception,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        self.failure_count = 0
        self.last_failure_time: Optional[float] = None
        self.state = "CLOSED"

    def __call__(self, func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            import time

            from .exceptions import CircuitBreakerOpenError

            if self.state == "OPEN":
                if (
                    self.last_failure_time
                    and time.time() - self.last_failure_time > self.recovery_timeout
                ):
                    self.state = "HALF_OPEN"
                    log.info(f"Circuit breaker for {func.__name__} entering HALF_OPEN state")
                else:
                    raise CircuitBreakerOpenError(
                        f"Circuit breaker is OPEN for {func.__name__}"
                    )

            try:
                result = func(*args, **kwargs)
                if self.state == "HALF_OPEN":
                    self.state = "CLOSED"
                    self.failure_count = 0
                    log.info(f"Circuit breaker for {func.__name__} recovered to CLOSED")
                return result
            except self.expected_exception as e:
                self.failure_count += 1
                self.last_failure_time = time.time()

                log.warning(
                    f"Circuit breaker failure for {func.__name__}",
                    failure_count=self.failure_count,
                    threshold=self.failure_threshold,
                )

                if self.failure_count >= self.failure_threshold:
                    self.state = "OPEN"
                    log.error(f"Circuit breaker for {func.__name__} is now OPEN")

                raise

        return wrapper


# Pre-configured circuit breakers
clickhouse_circuit_breaker = CircuitBreaker(
    failure_threshold=5,
    recovery_timeout=30,
    expected_exception=ClickHouseError,
)

ccusage_circuit_breaker = CircuitBreaker(
    failure_threshold=3,
    recovery_timeout=60,
    expected_exception=DataFetchError,
)
