/**
 * Number and string formatting utilities for UI display
 */

/**
 * Format a large number with K/M/B suffixes
 *
 * @param num - Number to format
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string with suffix
 *
 * @example
 * formatNumber(1234) // "1.2K"
 * formatNumber(1234567) // "1.2M"
 * formatNumber(1234567890) // "1.2B"
 */
export function formatNumber(num: number, decimals: number = 1): string {
  if (num === 0) return '0';

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    return sign + (abs / 1_000_000_000).toFixed(decimals) + 'B';
  }
  if (abs >= 1_000_000) {
    return sign + (abs / 1_000_000).toFixed(decimals) + 'M';
  }
  if (abs >= 1_000) {
    return sign + (abs / 1_000).toFixed(decimals) + 'K';
  }
  return sign + abs.toString();
}

/**
 * Format a cost value in USD
 *
 * @param cost - Cost in USD
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted cost string
 *
 * @example
 * formatCost(12.34) // "$12.34"
 * formatCost(0.5) // "$0.50"
 */
export function formatCost(cost: number, decimals: number = 2): string {
  return '$' + cost.toFixed(decimals);
}

/**
 * Format a duration in seconds to human-readable format
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 *
 * @example
 * formatDuration(45) // "45s"
 * formatDuration(90) // "1m 30s"
 * formatDuration(3661) // "1h 1m 1s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return Math.round(seconds) + 's';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');
  if (secs > 0 || parts.length === 0) parts.push(secs + 's');

  return parts.join(' ');
}

/**
 * Format a percentage value
 *
 * @param value - Value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 *
 * @example
 * formatPercentage(95.5) // "95.5%"
 * formatPercentage(100) // "100%"
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return value.toFixed(decimals) + '%';
}

/**
 * Format a date to ISO string (YYYY-MM-DD)
 *
 * @param date - Date object or date string
 * @returns ISO date string
 */
export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  return date.toISOString().split('T')[0];
}

/**
 * Format a datetime to ISO string
 *
 * @param date - Date object or datetime string
 * @returns ISO datetime string
 */
export function formatDateTime(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

/**
 * Truncate a string to a maximum length
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add when truncated (default: "...")
 * @returns Truncated string
 *
 * @example
 * truncate("very long string", 10) // "very lo..."
 */
export function truncate(
  str: string,
  maxLength: number,
  suffix: string = '...'
): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Pad a string to a fixed width
 *
 * @param str - String to pad
 * @param width - Target width
 * @param align - Alignment ('left', 'right', 'center')
 * @returns Padded string
 */
export function pad(
  str: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  if (str.length >= width) return str;

  const padding = width - str.length;

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center':
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
    default:
      return str + ' '.repeat(padding);
  }
}
