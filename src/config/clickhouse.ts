/**
 * ClickHouse connection configuration
 * Auto-detects HTTPS protocol for ports 443, 8443, 9440
 */

export interface ClickHouseConfigOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  protocol?: 'http' | 'https';
}

export class ClickHouseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly protocol: 'http' | 'https';
  readonly url: string;

  constructor(options: ClickHouseConfigOptions = {}) {
    // Load from environment variables with fallback to options
    this.host = options.host ?? process.env.CH_HOST ?? 'localhost';
    this.port = options.port ?? this.parsePort(process.env.CH_PORT ?? '8123');
    this.user = options.user ?? process.env.CH_USER ?? 'default';
    this.password = options.password ?? process.env.CH_PASSWORD ?? '';
    this.database = options.database ?? process.env.CH_DATABASE ?? 'default';

    // Auto-detect protocol if not explicitly provided
    this.protocol =
      options.protocol ??
      this.detectProtocol(this.port);

    this.url = `${this.protocol}://${this.host}:${this.port}`;
  }

  private parsePort(portStr: string): number {
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid ClickHouse port: ${portStr}`);
    }
    return port;
  }

  private detectProtocol(port: number): 'http' | 'https' {
    // Auto-detect HTTPS for standard secure ports
    if (port === 443 || port === 8443 || port === 9440) {
      return 'https';
    }
    return 'http';
  }

  /**
   * Validate that all required configuration is present
   */
  validate(): void {
    if (!this.host) {
      throw new Error('ClickHouse host is required (CH_HOST)');
    }
    if (!this.database) {
      throw new Error('ClickHouse database is required (CH_DATABASE)');
    }
    if (!this.user) {
      throw new Error('ClickHouse user is required (CH_USER)');
    }
  }

  /**
   * Create configuration from environment variables
   */
  static fromEnv(): ClickHouseConfig {
    return new ClickHouseConfig();
  }

  /**
   * Create a masked config for logging (hides password)
   */
  toMaskedString(): string {
    return `${this.url} (user=${this.user}, db=${this.database})`;
  }
}
