/**
 * Importer behavior configuration
 */

import * as os from 'node:os';

export interface ImporterConfigOptions {
  hashProjectNames?: boolean;
  opencodePath?: string;
  codexPath?: string;
  skipOpencode?: boolean;
  skipCodex?: boolean;
  skipCcusage?: boolean;
  source?: string;
  machineName?: string;
  commandTimeout?: number;
  maxParallelWorkers?: number;
}

export class ImporterConfig {
  readonly hashProjectNames: boolean;
  readonly opencodePath: string | null;
  readonly codexPath: string | null;
  readonly skipOpencode: boolean;
  readonly skipCodex: boolean;
  readonly skipCcusage: boolean;
  readonly source: string;
  readonly machineName: string;
  readonly commandTimeout: number;
  readonly maxParallelWorkers: number;

  constructor(options: ImporterConfigOptions = {}) {
    this.hashProjectNames =
      options.hashProjectNames ??
      process.env.HASH_PROJECT_NAMES !== 'false';
    this.opencodePath =
      options.opencodePath ??
      process.env.OPENCODE_DATA_DIR ??
      process.env.OPENCODE_PATH ??
      this.getDefaultOpenCodePath();
    this.codexPath = options.codexPath ?? process.env.CODEX_HOME ?? null;
    this.skipOpencode = options.skipOpencode ?? false;
    this.skipCodex = options.skipCodex ?? false;
    this.skipCcusage = options.skipCcusage ?? false;
    this.source = options.source ?? 'ccusage';
    this.machineName = options.machineName ?? this.detectMachineName();
    this.commandTimeout = options.commandTimeout ?? 120; // seconds
    this.maxParallelWorkers = options.maxParallelWorkers ?? 3;
  }

  private getDefaultOpenCodePath(): string | null {
    const home = os.homedir();
    const path = `${home}/.local/share/opencode/storage/message`;
    return path;
  }

  private detectMachineName(): string {
    return os.hostname();
  }

  /**
   * Validate configuration constraints
   */
  validate(): void {
    if (this.skipOpencode && this.skipCodex && this.skipCcusage) {
      throw new Error('Cannot skip ccusage, Codex, and OpenCode imports');
    }
    if (this.commandTimeout < 1 || this.commandTimeout > 600) {
      throw new Error(
        `Command timeout must be between 1 and 600 seconds, got ${this.commandTimeout}`
      );
    }
    if (this.maxParallelWorkers < 1 || this.maxParallelWorkers > 10) {
      throw new Error(
        `Max parallel workers must be between 1 and 10, got ${this.maxParallelWorkers}`
      );
    }
  }

  /**
   * Get display configuration for UI
   */
  toDisplayString(): {
    privacy: string;
    opencode: string;
    codex: string;
    ccusage: string;
    machine: string;
    timeout: string;
  } {
    return {
      privacy: this.hashProjectNames ? 'Enabled' : 'Disabled',
      opencode: this.skipOpencode ? 'Skipped' : 'Enabled',
      codex: this.skipCodex ? 'Skipped' : 'Enabled',
      ccusage: this.skipCcusage ? 'Skipped' : 'Enabled',
      machine: this.machineName,
      timeout: `${this.commandTimeout}s`,
    };
  }
}
