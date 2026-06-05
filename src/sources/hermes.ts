/**
 * Hermes Source
 *
 * Fetches usage data from Hermes agent SQLite database (~/.hermes/state.db).
 * Extracts exact token counts, cache read/write, reasoning tokens, and costs.
 */

import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { makeEventRow, hashProjectName } from '../parsers/parsers.js';
import type { DataSource, SourceResult, EventsSnapshotData } from '../pipeline/types.js';
import type { EventRow } from '../parsers/parsers.js';

export interface HermesSourceOptions {
  machineName: string;
  hashProjects?: boolean;
  verbose?: boolean;
  daysBack?: number;
  since?: string;
  endDate?: string;
  importId?: string;
}

function chNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export class HermesSource implements DataSource {
  readonly name = 'hermes';
  private opts: HermesSourceOptions;

  constructor(opts: HermesSourceOptions) {
    this.opts = opts;
  }

  async fetch(): Promise<SourceResult> {
    const { machineName, hashProjects = true, verbose, daysBack, since, endDate, importId = '' } = this.opts;

    let effectiveSince = since;
    if (!effectiveSince && daysBack != null && daysBack > 0) {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      effectiveSince = d.toISOString().split('T')[0];
    }

    const homeDir = process.env.HOME || '/Users/duet';
    const baseDir = process.env.HERMES_HOME || path.join(homeDir, '.hermes');
    const dbPath = path.join(baseDir, 'state.db');

    const events: EventRow[] = [];
    const now = chNow();

    if (!fs.existsSync(dbPath)) {
      if (verbose) console.warn(`Hermes state database not found: ${dbPath}`);
      return { sourceName: this.name, data: { events }, fetchedAt: new Date() };
    }

    const tempDbPath = path.join(os.tmpdir(), `hermes-${randomUUID()}.db`);
    const tempWalPath = `${tempDbPath}-wal`;
    const tempShmPath = `${tempDbPath}-shm`;
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    try {
      fs.copyFileSync(dbPath, tempDbPath);
      if (fs.existsSync(walPath)) {
        try { fs.copyFileSync(walPath, tempWalPath); } catch {}
      }
      if (fs.existsSync(shmPath)) {
        try { fs.copyFileSync(shmPath, tempShmPath); } catch {}
      }

      const db = new Database(tempDbPath, { readonly: true });

      // Determine date boundaries in seconds since Unix epoch
      let sinceSeconds = 0;
      if (effectiveSince) {
        sinceSeconds = Math.floor(new Date(`${effectiveSince}T00:00:00.000Z`).getTime() / 1000);
      }
      let endSeconds = Infinity;
      if (endDate) {
        endSeconds = Math.floor(new Date(`${endDate}T23:59:59.999Z`).getTime() / 1000);
      }

      // Query raw sessions from SQLite
      const sessions = db.query(`
        SELECT 
          id, 
          model, 
          started_at, 
          ended_at, 
          input_tokens, 
          output_tokens, 
          cache_write_tokens, 
          cache_read_tokens, 
          reasoning_tokens, 
          cwd, 
          estimated_cost_usd, 
          actual_cost_usd 
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
      `).all(
        sinceSeconds,
        endSeconds === Infinity ? 2147483647 : endSeconds
      ) as any[];

      db.close();

      // Aggregate for daily events
      // Key: date + '|' + model
      const dailySums: Record<string, {
        input: number;
        output: number;
        cacheCreation: number;
        cacheRead: number;
        reasoning: number;
        cost: number;
        cwd: string;
      }> = {};

      for (const row of sessions) {
        const input = row.input_tokens || 0;
        const output = row.output_tokens || 0;
        const cacheCreation = row.cache_write_tokens || 0;
        const cacheRead = row.cache_read_tokens || 0;
        const reasoning = row.reasoning_tokens || 0;
        const total = input + output + cacheRead + cacheCreation;

        // Skip completely empty sessions (0 tokens)
        if (total === 0) continue;

        const date = new Date(row.started_at * 1000).toISOString().split('T')[0];
        const model = row.model || 'unknown';
        const cost = row.actual_cost_usd || row.estimated_cost_usd || 0;
        const cwd = row.cwd || '';

        const key = `${date}|${model}`;
        if (!dailySums[key]) {
          dailySums[key] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0, cost: 0, cwd };
        }
        dailySums[key].input += input;
        dailySums[key].output += output;
        dailySums[key].cacheCreation += cacheCreation;
        dailySums[key].cacheRead += cacheRead;
        dailySums[key].reasoning += reasoning;
        dailySums[key].cost += cost;
        if (!dailySums[key].cwd && cwd) {
          dailySums[key].cwd = cwd;
        }

        // Build session event row
        const hashedSessionId = hashProjectName(row.id, hashProjects);
        const hashedProj = hashProjectName(cwd || row.id, hashProjects);

        const rawSessionKey = ['hermes', machineName, 'session', date, model, hashedSessionId].join('|');
        const sessionDedupKey = createHash('sha256').update(rawSessionKey).digest('hex').slice(0, 16);

        events.push(makeEventRow(now, {
          date,
          record_type: 'session',
          record_key: hashedSessionId,
          source: 'hermes',
          machine_name: machineName,
          model_name: model,
          session_id: hashedSessionId,
          project_path: hashedProj,
          input_tokens: input,
          output_tokens: output,
          cache_creation_tokens: cacheCreation,
          cache_read_tokens: cacheRead,
          reasoning_tokens: reasoning,
          total_tokens: total,
          cost,
          dedup_key: sessionDedupKey,
          import_id: importId,
          start_time: new Date(row.started_at * 1000).toISOString().replace('T', ' ').slice(0, 19),
          end_time: row.ended_at ? new Date(row.ended_at * 1000).toISOString().replace('T', ' ').slice(0, 19) : null,
          is_active: row.ended_at ? 0 : 1,
          created_at: now,
          updated_at: now,
        }));
      }

      // Build daily event rows
      for (const [key, sum] of Object.entries(dailySums)) {
        const [date, model] = key.split('|');
        const hashedProj = hashProjectName(sum.cwd || 'unknown', hashProjects);

        const rawDailyKey = ['hermes', machineName, 'daily', date, model, date].join('|');
        const dailyDedupKey = createHash('sha256').update(rawDailyKey).digest('hex').slice(0, 16);

        events.push(makeEventRow(now, {
          date,
          record_type: 'daily',
          record_key: date,
          source: 'hermes',
          machine_name: machineName,
          model_name: model,
          project_path: hashedProj,
          input_tokens: sum.input,
          output_tokens: sum.output,
          cache_creation_tokens: sum.cacheCreation,
          cache_read_tokens: sum.cacheRead,
          reasoning_tokens: sum.reasoning,
          total_tokens: sum.input + sum.output + sum.cacheRead + sum.cacheCreation,
          cost: sum.cost,
          dedup_key: dailyDedupKey,
          import_id: importId,
          created_at: now,
          updated_at: now,
        }));
      }

    } catch (e) {
      if (verbose) console.error(`Error parsing Hermes database: ${e}`);
    } finally {
      try { fs.unlinkSync(tempDbPath); } catch {}
      try { fs.unlinkSync(tempWalPath); } catch {}
      try { fs.unlinkSync(tempShmPath); } catch {}
    }

    if (verbose) {
      console.log(`Hermes Source parsed ${events.length} rows.`);
    }

    return { sourceName: this.name, data: { events }, fetchedAt: new Date() };
  }
}
