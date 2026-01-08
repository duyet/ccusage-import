/**
 * Database Repositories
 *
 * Data access layer for ccusage tables.
 * Provides type-safe methods for common database operations.
 */

import type { CHClient } from './client.js';
import type { ImporterConfig } from '../config/index.js';

/**
 * Daily usage repository
 */
export class DailyUsageRepository {
  constructor(
    private client: CHClient,
    private config: ImporterConfig
  ) {}

  /**
   * Upsert daily usage data
   */
  async upsert(data: DailyUsageRecord[]): Promise<void> {
    if (data.length === 0) return;

    const dates = data.map(d => d.date);

    // Delete existing records
    await this.client.delete('ccusage_usage_daily', {
      date: dates,
      machine_name: this.config.machineName,
      source: this.config.source,
    });

    // Insert new records
    await this.client.insert('ccusage_usage_daily', data);
  }

  /**
   * Get daily usage for date range
   */
  async getByDateRange(startDate: string, endDate: string): Promise<DailyUsageRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM ccusage_usage_daily
       WHERE date BETWEEN {start:String} AND {end:String}
       AND machine_name = {machine:String}
       AND source = {source:String}
       ORDER BY date DESC`,
      {
        start: startDate,
        end: endDate,
        machine: this.config.machineName,
        source: this.config.source,
      }
    );

    return await result.json();
  }

  /**
   * Get total costs by date
   */
  async getCostsByDate(days = 30): Promise<Array<{ date: string; cost: number }>> {
    const result = await this.client.query(
      `SELECT date, sum(total_cost) AS cost
       FROM ccusage_usage_daily
       WHERE date >= today() - {days:Int32}
       AND machine_name = {machine:String}
       AND source = {source:String}
       GROUP BY date
       ORDER BY date ASC`,
      {
        days,
        machine: this.config.machineName,
        source: this.config.source,
      }
    );

    return await result.json();
  }
}

/**
 * Model breakdowns repository
 */
export class ModelBreakdownsRepository {
  constructor(
    private client: CHClient,
    private config: ImporterConfig
  ) {}

  /**
   * Upsert model breakdown data
   */
  async upsert(
    recordType: string,
    recordKeys: string[],
    data: ModelBreakdownRecord[]
  ): Promise<void> {
    if (data.length === 0) return;

    // Delete existing records
    await this.client.delete('ccusage_model_breakdowns', {
      record_type: recordType,
      record_key: recordKeys,
      source: this.config.source,
    });

    // Insert new records
    await this.client.insert('ccusage_model_breakdowns', data);
  }

  /**
   * Get model rankings by cost
   */
  async getRankingsByCost(limit = 10): Promise<ModelRanking[]> {
    const result = await this.client.query(
      `SELECT
         model_name,
         sum(cost) AS total_cost,
         sum(input_tokens + output_tokens) AS total_tokens
       FROM ccusage_model_breakdowns
       WHERE machine_name = {machine:String}
       AND source = {source:String}
       GROUP BY model_name
       ORDER BY total_cost DESC
       LIMIT {limit:Int32}`,
      {
        machine: this.config.machineName,
        source: this.config.source,
        limit,
      }
    );

    return await result.json();
  }
}

/**
 * Blocks repository
 */
export class BlocksRepository {
  constructor(
    private client: CHClient,
    private config: ImporterConfig
  ) {}

  /**
   * Upsert billing block data
   */
  async upsert(data: BlockRecord[]): Promise<void> {
    if (data.length === 0) return;

    const blockIds = data.map(b => b.block_id);

    // Delete existing records
    await this.client.delete('ccusage_usage_blocks', {
      block_id: blockIds,
      machine_name: this.config.machineName,
      source: this.config.source,
    });

    // Insert new records
    await this.client.insert('ccusage_usage_blocks', data);
  }

  /**
   * Get active blocks
   */
  async getActiveBlocks(): Promise<BlockRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM ccusage_usage_blocks
       WHERE is_active = 1
       AND machine_name = {machine:String}
       AND source = {source:String}
       ORDER BY end_time ASC`,
      {
        machine: this.config.machineName,
        source: this.config.source,
      }
    );

    return await result.json();
  }
}

/**
 * Table type definitions
 */
export interface DailyUsageRecord {
  date: string;
  machine_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  total_cost: number;
  models_count: number;
  created_at: string;
  updated_at: string;
  source: string;
}

export interface ModelBreakdownRecord {
  record_type: string;
  record_key: string;
  machine_name: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost: number;
  created_at: string;
  source: string;
}

export interface BlockRecord {
  block_id: string;
  machine_name: string;
  start_time: string;
  end_time: string;
  actual_end_time: string | null;
  is_active: number;
  is_gap: number;
  entries: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  models_count: number;
  created_at: string;
  updated_at: string;
  usage_limit_reset_time: string | null;
  burn_rate: number | null;
  projection: number | null;
  source: string;
}

export interface ModelRanking {
  model_name: string;
  total_cost: number;
  total_tokens: number;
}
