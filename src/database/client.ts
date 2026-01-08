
/**
 * ClickHouse client wrapper
 */

import { createClient } from '@clickhouse/client';
import type { ClickHouseConfig } from '../config/clickhouse.js';

/**
 * ClickHouse client wrapper with async/await support
 */
export class CHClient {
  private client: ReturnType<typeof createClient>;
  private connected: boolean = false;

  constructor(config: ClickHouseConfig) {
    this.client = createClient({
      url: config.url,
      username: config.user,
      password: config.password,
      database: config.database,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      await this.client.ping();
      this.connected = true;
    } catch (error) {
      throw new Error(`Failed to connect to ClickHouse: ${error}`);
    }
  }

  async query<T extends Record<string, unknown>>(
    query: string,
    parameters?: Record<string, unknown>
  ): Promise<T[]> {
    await this.connect();
    try {
      const resultSet = await this.client.query({
        query,
        query_params: parameters,
        format: 'JSONEachRow',
      });
      const rows = await resultSet.json<T>();
      return rows;
    } catch (error) {
      throw new Error(`Query failed: ${error}`);
    }
  }

  async insert(table: string, values: Array<Record<string, unknown>>): Promise<void> {
    await this.connect();
    try {
      await this.client.insert({
        table,
        values,
        format: 'JSONEachRow',
      });
    } catch (error) {
      throw new Error(`Insert failed for table '${table}': ${error}`);
    }
  }

  async delete(table: string, conditions: Record<string, unknown | unknown[]>): Promise<void> {
    await this.connect();
    const whereParts: string[] = [];
    const queryParams: Record<string, unknown> = {};

    Object.entries(conditions).forEach(([col, value], idx) => {
      const paramName = 'param_' + idx;
      if (Array.isArray(value)) {
        whereParts.push(col + ' IN ({' + paramName + ':Array(String)})');
        queryParams[paramName] = value;
      } else {
        whereParts.push(col + ' = {' + paramName + ':String}');
        queryParams[paramName] = value;
      }
    });

    const query = 'ALTER TABLE ' + table + ' DELETE WHERE ' + whereParts.join(' AND ');
    try {
      await this.client.command({
        query,
        query_params: queryParams,
      });
    } catch (error) {
      throw new Error(`Delete failed for table '${table}': ${error}`);
    }
  }

  async command(query: string, parameters?: Record<string, unknown>): Promise<void> {
    await this.connect();
    try {
      await this.client.command({ query, query_params: parameters });
    } catch (error) {
      throw new Error(`Command failed: ${error}`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async getServerVersion(): Promise<string> {
    const result = await this.query<{ version: string }>('SELECT version() as version');
    return result[0]?.version ?? 'unknown';
  }

  async tableExists(tableName: string): Promise<boolean> {
    const result = await this.query<{ exists: string }>('EXISTS TABLE ' + tableName);
    return result[0]?.exists === '1';
  }

  async getRowCount(tableName: string): Promise<number> {
    const result = await this.query<{ count: string }>('SELECT count() as count FROM ' + tableName);
    return parseInt(result[0]?.count ?? '0', 10);
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
