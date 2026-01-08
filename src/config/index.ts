/**
 * Configuration module exports
 */

import { ClickHouseConfig } from './clickhouse.js';
import type { ClickHouseConfigOptions } from './clickhouse.js';
import { ImporterConfig } from './importer.js';
import type { ImporterConfigOptions } from './importer.js';
import { UIConfig } from './ui.js';
import type { UIConfigOptions } from './ui.js';

// Re-export types and classes
export type { ClickHouseConfigOptions } from './clickhouse.js';
export type { ImporterConfigOptions } from './importer.js';
export type { UIConfigOptions } from './ui.js';
export { ClickHouseConfig } from './clickhouse.js';
export { ImporterConfig } from './importer.js';
export { UIConfig } from './ui.js';

/**
 * Central configuration manager combining all configs
 */
export interface ConfigOptions {
  clickhouse?: ClickHouseConfigOptions;
  importer?: ImporterConfigOptions;
  ui?: UIConfigOptions;
}

export class ConfigManager {
  readonly clickhouse: ClickHouseConfig;
  readonly importer: ImporterConfig;
  readonly ui: UIConfig;

  constructor(options: ConfigOptions = {}) {
    this.clickhouse = new ClickHouseConfig(options.clickhouse);
    this.importer = new ImporterConfig(options.importer);
    this.ui = new UIConfig(options.ui);

    // Validate all configurations
    this.clickhouse.validate();
    this.importer.validate();
    this.ui.validate();
  }

  /**
   * Create config manager from environment variables
   */
  static fromEnv(): ConfigManager {
    return new ConfigManager();
  }

  /**
   * Display summary of current configuration
   */
  displaySummary(): void {
    if (!this.ui.shouldShowOutput()) return;

    console.log('Configuration loaded successfully');
  }
}
