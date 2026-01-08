/**
 * UI and display configuration
 */

export interface UIConfigOptions {
  animated?: boolean;
  colorEnabled?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  heatmapMinIntensity?: number;
  heatmapMaxIntensity?: number;
}

export class UIConfig {
  readonly animated: boolean;
  readonly colorEnabled: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly heatmapMinIntensity: number;
  readonly heatmapMaxIntensity: number;

  constructor(options: UIConfigOptions = {}) {
    this.animated = options.animated ?? process.stdout.isTTY ?? false;
    this.colorEnabled =
      options.colorEnabled ??
      (process.env.NO_COLOR === undefined && process.stdout.isTTY);
    this.verbose = options.verbose ?? process.env.VERBOSE === 'true';
    this.quiet = options.quiet ?? process.env.QUIET === 'true';
    this.heatmapMinIntensity = options.heatmapMinIntensity ?? 1;
    this.heatmapMaxIntensity = options.heatmapMaxIntensity ?? 5;
  }

  /**
   * Validate configuration constraints
   */
  validate(): void {
    if (
      this.heatmapMinIntensity < 0 ||
      this.heatmapMinIntensity > this.heatmapMaxIntensity
    ) {
      throw new Error(
        `Invalid heatmap intensity range: [${this.heatmapMinIntensity}, ${this.heatmapMaxIntensity}]`
      );
    }
    if (this.heatmapMaxIntensity > 10) {
      throw new Error(
        `Heatmap max intensity cannot exceed 10, got ${this.heatmapMaxIntensity}`
      );
    }
  }

  /**
   * Check if we should show detailed output
   */
  shouldShowDetails(): boolean {
    return this.verbose && !this.quiet;
  }

  /**
   * Check if we should show any output at all
   */
  shouldShowOutput(): boolean {
    return !this.quiet;
  }

  /**
   * Get heatmap intensity levels
   */
  getHeatmapLevels(): number[] {
    return Array.from(
      { length: this.heatmapMaxIntensity - this.heatmapMinIntensity + 1 },
      (_, i) => this.heatmapMinIntensity + i
    );
  }
}
