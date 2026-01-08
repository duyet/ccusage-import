/**
 * Color Utilities
 *
 * Terminal-safe color palette and color manipulation functions.
 */

/**
 * Main color palette for the terminal UI
 * Colors are chosen for accessibility and terminal compatibility
 */
export const colors = {
  // Status colors
  success: '#4ade80',      // green
  warning: '#fbbf24',      // amber
  error: '#ef4444',        // red
  info: '#60a5fa',         // blue

  // Neutral colors
  background: '#0a0a0a',   // near-black
  foreground: '#e5e7eb',   // light gray
  muted: '#6b7280',        // medium gray
  border: '#333333',       // subtle border

  // Accent colors
  primary: '#fbbf24',      // amber (primary accent)
  secondary: '#60a5fa',    // blue (secondary accent)

  // Token type colors
  input: '#60a5fa',        // blue
  output: '#f472b6',       // pink
  cacheRead: '#a78bfa',    // purple
  cacheCreation: '#c084fc', // purple-light

  // Heatmap colors (GitHub-style greens)
  heatmap0: '#1a1a1a',
  heatmap1: '#0e4429',
  heatmap2: '#006d32',
  heatmap3: '#26a641',
  heatmap4: '#39d353',
} as const;

export type ColorName = keyof typeof colors;

/**
 * Get color by name with fallback
 */
export function getColor(name: ColorName, fallback = '#ffffff'): string {
  return colors[name] || fallback;
}

/**
 * Check if color is dark (for contrast calculations)
 */
export function isDarkColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/**
 * Status color mapping
 */
export function getStatusColor(status: 'success' | 'warning' | 'error' | 'info' | 'loading'): string {
  const statusColors = {
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.info,
    loading: colors.warning,
  };
  return statusColors[status];
}

/**
 * Intensity level to heatmap color mapping
 */
export function getHeatmapColor(level: number): string {
  const levelKey = `heatmap${level}` as keyof typeof colors;
  return colors[levelKey] || colors.heatmap0;
}
