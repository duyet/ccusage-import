/**
 * Antigravity Source
 *
 * Fetches usage data from Antigravity CLI conversations (~/.gemini/antigravity-cli/).
 * Parses SQLite databases for exact token counts, and estimates older encrypted Protobuf logs.
 */

import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { makeEventRow, hashProjectName } from '../parsers/parsers.js';
import type { DataSource, SourceResult, EventsSnapshotData } from '../pipeline/types.js';
import type { EventRow } from '../parsers/parsers.js';

export interface AntigravitySourceOptions {
  machineName: string;
  hashProjects?: boolean;
  verbose?: boolean;
  daysBack?: number;
  since?: string;
  endDate?: string;
  importId?: string;
}

// Protobuf decoding helper (varint and field tags)
function parseVarint(data: Uint8Array, pos: number): [number, number] {
  let val = 0;
  let shift = 0;
  while (true) {
    if (pos >= data.length) return [val, pos];
    const b = data[pos];
    pos++;
    val |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  return [val, pos];
}

interface ProtoField {
  type: 'varint' | 'fixed64' | 'bytes_or_sub' | 'fixed32';
  value: any;
}

type DecodedProto = Record<number, ProtoField[]>;

function decodeProto(data: Uint8Array, pos = 0, end = data.length): DecodedProto {
  const res: DecodedProto = {};
  while (pos < end) {
    const [key, nextPos] = parseVarint(data, pos);
    pos = nextPos;
    const wireType = key & 0x7;
    const fieldNum = key >> 3;

    if (wireType === 0) {
      const [val, nextPos2] = parseVarint(data, pos);
      pos = nextPos2;
      if (!res[fieldNum]) res[fieldNum] = [];
      res[fieldNum].push({ type: 'varint', value: val });
    } else if (wireType === 1) {
      const val = data.slice(pos, pos + 8);
      pos += 8;
      if (!res[fieldNum]) res[fieldNum] = [];
      res[fieldNum].push({ type: 'fixed64', value: val });
    } else if (wireType === 2) {
      const [len, nextPos2] = parseVarint(data, pos);
      if (len < 0 || nextPos2 + len > end) break;
      pos = nextPos2;
      const val = data.slice(pos, pos + len);
      pos += len;
      let parsedVal: any = val;
      try {
        const sub = decodeProto(val, 0, val.length);
        if (Object.keys(sub).length > 0) {
          parsedVal = sub;
        }
      } catch (e) {}
      if (!res[fieldNum]) res[fieldNum] = [];
      res[fieldNum].push({ type: 'bytes_or_sub', value: parsedVal });
    } else if (wireType === 5) {
      const val = data.slice(pos, pos + 4);
      pos += 4;
      if (!res[fieldNum]) res[fieldNum] = [];
      res[fieldNum].push({ type: 'fixed32', value: val });
    } else {
      break;
    }
  }
  return res;
}

function extractTokens(decoded: DecodedProto): { prompt: number; cached: number; comp: number } | null {
  try {
    const f1List = decoded[1];
    if (!f1List) return null;
    const f1 = f1List[0].value as DecodedProto;

    const f4List = f1[4];
    if (!f4List) return null;
    const f4 = f4List[0].value as DecodedProto;

    const prompt = (f4[2]?.[0]?.value ?? 0) as number;
    const cached = (f4[5]?.[0]?.value ?? 0) as number;
    const comp = (f4[3]?.[0]?.value ?? 0) as number;

    return {
      prompt: prompt < 9000000000000000000 ? prompt : 0,
      cached: cached < 9000000000000000000 ? cached : 0,
      comp: comp < 9000000000000000000 ? comp : 0
    };
  } catch (e) {
    return null;
  }
}

function extractModel(decoded: DecodedProto): string {
  try {
    const f1List = decoded[1];
    if (!f1List) return 'gemini-3.5-flash-medium';
    const f1 = f1List[0].value as DecodedProto;

    const f19List = f1[19];
    if (f19List && f19List[0]?.value instanceof Uint8Array) {
      return new TextDecoder().decode(f19List[0].value);
    }
    const f21List = f1[21];
    if (f21List && f21List[0]?.value instanceof Uint8Array) {
      return new TextDecoder().decode(f21List[0].value);
    }
  } catch (e) {}
  return 'gemini-3.5-flash-medium';
}

function extractTimestamp(decoded: DecodedProto): Date | null {
  try {
    const f1List = decoded[1];
    if (!f1List) return null;
    const f1 = f1List[0].value as DecodedProto;

    const f9List = f1[9];
    if (!f9List) return null;
    const f9 = f9List[0].value as DecodedProto;

    const f4List = f9[4];
    if (!f4List) return null;
    const f4 = f4List[0].value as DecodedProto;

    const seconds = (f4[1]?.[0]?.value ?? 0) as number;
    const nanos = (f4[2]?.[0]?.value ?? 0) as number;

    if (seconds > 0) {
      return new Date(seconds * 1000 + nanos / 1000000);
    }
  } catch (e) {}
  return null;
}

function chNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Averages per prompt to estimate older Protobuf conversations (.pb)
const EST_PROMPT_TOKENS = 198705;
const EST_COMP_TOKENS = 11990;
const EST_CACHED_TOKENS = 4075117;

export class AntigravitySource implements DataSource {
  readonly name = 'antigravity';
  private opts: AntigravitySourceOptions;

  constructor(opts: AntigravitySourceOptions) {
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
    const cliDir = path.join(homeDir, '.gemini/antigravity-cli');
    const convDir = path.join(cliDir, 'conversations');
    const historyFile = path.join(cliDir, 'history.jsonl');

    const events: EventRow[] = [];
    const now = chNow();

    if (!fs.existsSync(convDir)) {
      if (verbose) console.warn(`Antigravity conversations dir not found: ${convDir}`);
      return { sourceName: this.name, data: { events }, fetchedAt: new Date() };
    }

    // 1. Parse history.jsonl to map conversation IDs -> workspaces/projects and dates
    const projectsMap: Record<string, string> = {};
    const historyPrompts: Record<string, Array<{ date: string; timestamp: number }>> = {};

    if (fs.existsSync(historyFile)) {
      try {
        const lines = fs.readFileSync(historyFile, 'utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line);
          const cid = entry.conversationId;
          const workspace = entry.workspace;
          const ts = entry.timestamp;
          if (cid && workspace) {
            projectsMap[cid] = workspace;
          }
          if (cid && ts) {
            const date = new Date(ts).toISOString().split('T')[0];
            if (!historyPrompts[cid]) historyPrompts[cid] = [];
            historyPrompts[cid].push({ date, timestamp: ts });
          }
        }
      } catch (e) {
        if (verbose) console.error(`Error parsing history.jsonl: ${e}`);
      }
    }

    // List all conversation files (.db and .pb)
    const files = fs.readdirSync(convDir);
    const dbFiles = files.filter(f => f.endsWith('.db'));
    const pbFiles = files.filter(f => f.endsWith('.pb'));

    // 2. Parse exact SQLite (.db) conversations
    const dbDailySums: Record<string, { prompt: number; cached: number; comp: number; count: number; model: string; workspace: string }> = {};
    const dbSessionSums: Record<string, { prompt: number; cached: number; comp: number; model: string; workspace: string; date: string }> = {};

    for (const file of dbFiles) {
      const dbPath = path.join(convDir, file);
      const cid = file.replace('.db', '');
      const workspace = projectsMap[cid] || cid;

      const tempDbPath = path.join(os.tmpdir(), `${cid}-${randomUUID()}.db`);
      const tempWalPath = `${tempDbPath}-wal`;
      const tempShmPath = `${tempDbPath}-shm`;
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;

      try {
        fs.copyFileSync(dbPath, tempDbPath);
        if (fs.existsSync(walPath)) {
          fs.copyFileSync(walPath, tempWalPath);
        }
        if (fs.existsSync(shmPath)) {
          fs.copyFileSync(shmPath, tempShmPath);
        }

        const db = new Database(tempDbPath);
        const rows = db.query('SELECT data FROM gen_metadata').all() as Array<{ data: Uint8Array }>;
        
        for (const row of rows) {
          if (!row.data) continue;
          const decoded = decodeProto(row.data);
          const tokens = extractTokens(decoded);
          const timestamp = extractTimestamp(decoded);
          const model = extractModel(decoded);

          if (tokens && timestamp) {
            const date = timestamp.toISOString().split('T')[0];
            
            // Check filters
            if (effectiveSince && date < effectiveSince) continue;
            if (endDate && date > endDate) continue;

            const dailyKey = `${date}|${model}`;
            if (!dbDailySums[dailyKey]) {
              dbDailySums[dailyKey] = { prompt: 0, cached: 0, comp: 0, count: 0, model, workspace };
            }
            dbDailySums[dailyKey].prompt += tokens.prompt;
            dbDailySums[dailyKey].cached += tokens.cached;
            dbDailySums[dailyKey].comp += tokens.comp;
            dbDailySums[dailyKey].count += 1;

            const sessionKey = `${cid}|${date}|${model}`;
            if (!dbSessionSums[sessionKey]) {
              dbSessionSums[sessionKey] = { prompt: 0, cached: 0, comp: 0, model, workspace, date };
            }
            dbSessionSums[sessionKey].prompt += tokens.prompt;
            dbSessionSums[sessionKey].cached += tokens.cached;
            dbSessionSums[sessionKey].comp += tokens.comp;
          }
        }
        db.close();
      } catch (e) {
        if (verbose) console.error(`Error reading database ${file}: ${e}`);
      } finally {
        try { if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath); } catch {}
        try { if (fs.existsSync(tempWalPath)) fs.unlinkSync(tempWalPath); } catch {}
        try { if (fs.existsSync(tempShmPath)) fs.unlinkSync(tempShmPath); } catch {}
      }
    }

    // Build SQLite daily rows
    for (const [key, sum] of Object.entries(dbDailySums)) {
      const [date, model] = key.split('|');
      const hashedProj = hashProjectName(sum.workspace, hashProjects);
      
      const rawKey = ['antigravity', machineName, 'daily', date, model, date].join('|');
      const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);

      events.push(makeEventRow(now, {
        date,
        record_type: 'daily',
        record_key: date,
        source: 'antigravity',
        machine_name: machineName,
        model_name: model,
        project_path: hashedProj,
        input_tokens: sum.prompt,
        output_tokens: sum.comp,
        cache_creation_tokens: 0,
        cache_read_tokens: sum.cached,
        reasoning_tokens: 0,
        total_tokens: sum.prompt + sum.comp + sum.cached,
        cost: 0,
        dedup_key: dedupKey,
        import_id: importId,
        created_at: now,
        updated_at: now,
      }));
    }

    // Build SQLite session rows
    for (const [key, sum] of Object.entries(dbSessionSums)) {
      const [cid, date, model] = key.split('|');
      const hashedCid = hashProjectName(cid, hashProjects);
      const hashedProj = hashProjectName(sum.workspace, hashProjects);

      const rawKey = ['antigravity', machineName, 'session', date, model, hashedCid].join('|');
      const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);

      events.push(makeEventRow(now, {
        date,
        record_type: 'session',
        record_key: hashedCid,
        source: 'antigravity',
        machine_name: machineName,
        model_name: model,
        session_id: hashedCid,
        project_path: hashedProj,
        input_tokens: sum.prompt,
        output_tokens: sum.comp,
        cache_creation_tokens: 0,
        cache_read_tokens: sum.cached,
        reasoning_tokens: 0,
        total_tokens: sum.prompt + sum.comp + sum.cached,
        cost: 0,
        dedup_key: dedupKey,
        import_id: importId,
        created_at: now,
        updated_at: now,
      }));
    }

    // 3. Estimate older encrypted Protobuf (.pb) conversations
    const pbDailySums: Record<string, { prompt: number; cached: number; comp: number; count: number; model: string; workspace: string }> = {};
    const pbSessionSums: Record<string, { prompt: number; cached: number; comp: number; model: string; workspace: string; date: string }> = {};

    for (const file of pbFiles) {
      const cid = file.replace('.pb', '');
      const workspace = projectsMap[cid] || cid;
      const prompts = historyPrompts[cid] || [];

      for (const p of prompts) {
        const date = p.date;
        if (effectiveSince && date < effectiveSince) continue;
        if (endDate && date > endDate) continue;

        const model = 'gemini-3.5-flash-medium';

        const dailyKey = `${date}|${model}`;
        if (!pbDailySums[dailyKey]) {
          pbDailySums[dailyKey] = { prompt: 0, cached: 0, comp: 0, count: 0, model, workspace };
        }
        pbDailySums[dailyKey].prompt += EST_PROMPT_TOKENS;
        pbDailySums[dailyKey].cached += EST_CACHED_TOKENS;
        pbDailySums[dailyKey].comp += EST_COMP_TOKENS;
        pbDailySums[dailyKey].count += 1;

        const sessionKey = `${cid}|${date}|${model}`;
        if (!pbSessionSums[sessionKey]) {
          pbSessionSums[sessionKey] = { prompt: 0, cached: 0, comp: 0, model, workspace, date };
        }
        pbSessionSums[sessionKey].prompt += EST_PROMPT_TOKENS;
        pbSessionSums[sessionKey].cached += EST_CACHED_TOKENS;
        pbSessionSums[sessionKey].comp += EST_COMP_TOKENS;
      }
    }

    // Build PB daily rows
    for (const [key, sum] of Object.entries(pbDailySums)) {
      const [date, model] = key.split('|');
      const hashedProj = hashProjectName(sum.workspace, hashProjects);
      
      const rawKey = ['antigravity', machineName, 'daily', date, model, date].join('|');
      const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);

      events.push(makeEventRow(now, {
        date,
        record_type: 'daily',
        record_key: date,
        source: 'antigravity',
        machine_name: machineName,
        model_name: model,
        project_path: hashedProj,
        input_tokens: sum.prompt,
        output_tokens: sum.comp,
        cache_creation_tokens: 0,
        cache_read_tokens: sum.cached,
        reasoning_tokens: 0,
        total_tokens: sum.prompt + sum.comp + sum.cached,
        cost: 0,
        dedup_key: dedupKey,
        import_id: importId,
        created_at: now,
        updated_at: now,
      }));
    }

    // Build PB session rows
    for (const [key, sum] of Object.entries(pbSessionSums)) {
      const [cid, date, model] = key.split('|');
      const hashedCid = hashProjectName(cid, hashProjects);
      const hashedProj = hashProjectName(sum.workspace, hashProjects);

      const rawKey = ['antigravity', machineName, 'session', date, model, hashedCid].join('|');
      const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);

      events.push(makeEventRow(now, {
        date,
        record_type: 'session',
        record_key: hashedCid,
        source: 'antigravity',
        machine_name: machineName,
        model_name: model,
        session_id: hashedCid,
        project_path: hashedProj,
        input_tokens: sum.prompt,
        output_tokens: sum.comp,
        cache_creation_tokens: 0,
        cache_read_tokens: sum.cached,
        reasoning_tokens: 0,
        total_tokens: sum.prompt + sum.comp + sum.cached,
        cost: 0,
        dedup_key: dedupKey,
        import_id: importId,
        created_at: now,
        updated_at: now,
      }));
    }

    // 4. Estimate implicit subagents
    const implicitDir = path.join(cliDir, 'implicit');
    if (fs.existsSync(implicitDir)) {
      try {
        const implicitFiles = fs.readdirSync(implicitDir).filter(f => f.endsWith('.pb'));
        let totalImplicitSize = 0;
        for (const file of implicitFiles) {
          totalImplicitSize += fs.statSync(path.join(implicitDir, file)).size;
        }

        if (totalImplicitSize > 0) {
          // 1 MB of pb is roughly 500K tokens (Input+Output) and 9.6M cached.
          const totalImplicitBurn = Math.round((totalImplicitSize / (1024 * 1024)) * 500000);
          const totalImplicitCached = Math.round((totalImplicitSize / (1024 * 1024)) * 9600000);
          const implicitPrompt = Math.round(totalImplicitBurn * 0.94);
          const implicitComp = totalImplicitBurn - implicitPrompt;

          const date = new Date().toISOString().split('T')[0];
          const model = 'gemini-3.5-flash-medium';
          const session = 'implicit-subagents';
          const hashedSession = hashProjectName(session, hashProjects);

          const rawKey = ['antigravity', machineName, 'daily', date, model, date].join('|');
          const dedupKey = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);

          events.push(makeEventRow(now, {
            date,
            record_type: 'daily',
            record_key: date,
            source: 'antigravity',
            machine_name: machineName,
            model_name: model,
            project_path: hashedSession,
            input_tokens: implicitPrompt,
            output_tokens: implicitComp,
            cache_creation_tokens: 0,
            cache_read_tokens: totalImplicitCached,
            reasoning_tokens: 0,
            total_tokens: totalImplicitBurn + totalImplicitCached,
            cost: 0,
            dedup_key: dedupKey,
            import_id: importId,
            created_at: now,
            updated_at: now,
          }));
        }
      } catch (e) {
        if (verbose) console.error(`Error estimating implicit subagents: ${e}`);
      }
    }

    if (verbose) {
      console.log(`Antigravity Source parsed ${events.length} rows.`);
    }

    return { sourceName: this.name, data: { events }, fetchedAt: new Date() };
  }
}
