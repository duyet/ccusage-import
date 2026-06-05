import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HermesSource } from '../../src/sources/hermes.js';

describe('HermesSource', () => {
  let tempDir: string;
  let oldHermesHome: string | undefined;

  beforeAll(() => {
    oldHermesHome = process.env.HERMES_HOME;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-test-'));
    process.env.HERMES_HOME = tempDir;

    // Create a mock state.db SQLite database
    const dbPath = path.join(tempDir, 'state.db');
    const db = new Database(dbPath);

    db.run(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        user_id TEXT,
        model TEXT,
        model_config TEXT,
        system_prompt TEXT,
        parent_session_id TEXT,
        started_at REAL NOT NULL,
        ended_at REAL,
        end_reason TEXT,
        message_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        cwd TEXT,
        billing_provider TEXT,
        billing_base_url TEXT,
        billing_mode TEXT,
        estimated_cost_usd REAL,
        actual_cost_usd REAL,
        cost_status TEXT,
        cost_source TEXT,
        pricing_version TEXT,
        title TEXT,
        api_call_count INTEGER DEFAULT 0,
        handoff_state TEXT,
        handoff_platform TEXT,
        handoff_error TEXT,
        rewind_count INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Insert 4 test sessions:
    // Session 1: completed, non-zero tokens, actual cost
    db.run(`
      INSERT INTO sessions (
        id, source, model, started_at, ended_at, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens, cwd, actual_cost_usd
      ) VALUES (
        'session_1', 'tui', 'glm-4.7', 1780505000, 1780506000, 1000, 500, 200, 100, 50, '/path/to/project_a', 0.05
      )
    `);

    // Session 2: active (ended_at is null), non-zero tokens, estimated cost
    db.run(`
      INSERT INTO sessions (
        id, source, model, started_at, ended_at, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens, cwd, estimated_cost_usd
      ) VALUES (
        'session_2', 'tui', 'glm-4.7', 1780507000, NULL, 2000, 1000, 400, 200, 100, '/path/to/project_a', 0.10
      )
    `);

    // Session 3: empty session (0 tokens) -> should be skipped
    db.run(`
      INSERT INTO sessions (
        id, source, model, started_at, ended_at, input_tokens, output_tokens
      ) VALUES (
        'session_3', 'tui', 'glm-4.7', 1780508000, 1780509000, 0, 0
      )
    `);

    // Session 4: outside since date boundary -> should be filtered
    // 1780505000 is Wednesday, June 3, 2026 UTC
    // We will query starting from June 4, 2026
    db.run(`
      INSERT INTO sessions (
        id, source, model, started_at, ended_at, input_tokens, output_tokens, cwd
      ) VALUES (
        'session_4', 'tui', 'glm-4.7', 1780405000, 1780406000, 500, 100, '/path/to/project_b'
      )
    `);

    db.close();
  });

  afterAll(() => {
    if (oldHermesHome !== undefined) {
      process.env.HERMES_HOME = oldHermesHome;
    } else {
      delete process.env.HERMES_HOME;
    }
    // Clean up temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly reads, filters, and parses Hermes sessions and daily totals', async () => {
    // 1780505000 is 2026-06-03
    // We set since boundary to '2026-06-02' to include session_1 and session_2, but exclude session_4 (which is 1780405000, 2026-06-02 early morning or 2026-06-01 depending on timezone)
    // Wait, 1780405000 is Tuesday, June 2, 2026 10:16:40 AM UTC
    // Let's set effectiveSince to '2026-06-03' to filter out session_4 (started on June 2)
    const source = new HermesSource({
      machineName: 'test-host',
      hashProjects: false, // disable hashing for easy assertions
      since: '2026-06-03',
      verbose: false,
    });

    const result = await source.fetch();
    expect(result.sourceName).toBe('hermes');
    expect(result.data.events).toHaveLength(3); // 2 sessions + 1 daily

    // Verify session events
    const sessionEvents = result.data.events.filter(e => e.record_type === 'session');
    expect(sessionEvents).toHaveLength(2);

    const s1 = sessionEvents.find(e => e.session_id === 'session_1');
    expect(s1).toBeDefined();
    expect(s1!.model_name).toBe('glm-4.7');
    expect(s1!.project_path).toBe('/path/to/project_a');
    expect(s1!.input_tokens).toBe(1000);
    expect(s1!.output_tokens).toBe(500);
    expect(s1!.cache_creation_tokens).toBe(100);
    expect(s1!.cache_read_tokens).toBe(200);
    expect(s1!.reasoning_tokens).toBe(50);
    expect(s1!.total_tokens).toBe(1800); // 1000 + 500 + 200 + 100
    expect(s1!.cost).toBe(0.05);
    expect(s1!.is_active).toBe(0); // completed
    expect(s1!.start_time).toBe('2026-06-03 16:43:20');

    const s2 = sessionEvents.find(e => e.session_id === 'session_2');
    expect(s2).toBeDefined();
    expect(s2!.cost).toBe(0.10);
    expect(s2!.is_active).toBe(1); // active
    expect(s2!.start_time).toBe('2026-06-03 17:16:40');

    // Verify daily event
    const dailyEvents = result.data.events.filter(e => e.record_type === 'daily');
    expect(dailyEvents).toHaveLength(1);

    const d = dailyEvents[0];
    expect(d.date).toBe('2026-06-03');
    expect(d.model_name).toBe('glm-4.7');
    expect(d.project_path).toBe('/path/to/project_a');
    expect(d.input_tokens).toBe(3000); // 1000 + 2000
    expect(d.output_tokens).toBe(1500); // 500 + 1000
    expect(d.cache_creation_tokens).toBe(300); // 100 + 200
    expect(d.cache_read_tokens).toBe(600); // 200 + 400
    expect(d.reasoning_tokens).toBe(150); // 50 + 100
    expect(d.total_tokens).toBe(5400);
    expect(d.cost).toBeCloseTo(0.15, 5); // 0.05 + 0.10
  });

  it('exits gracefully if database does not exist', async () => {
    // Set to a non-existent directory
    process.env.HERMES_HOME = path.join(tempDir, 'non-existent');
    const source = new HermesSource({
      machineName: 'test-host',
      verbose: false,
    });
    const result = await source.fetch();
    expect(result.sourceName).toBe('hermes');
    expect(result.data.events).toHaveLength(0);
  });
});
