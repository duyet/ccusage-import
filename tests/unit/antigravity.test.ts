import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AntigravitySource } from '../../src/sources/antigravity.js';

function encodeVarint(value: number): Uint8Array {
  const bytes = [];
  let val = value;
  while (true) {
    let b = val & 0x7f;
    val >>>= 7;
    if (val > 0) {
      b |= 0x80;
      bytes.push(b);
    } else {
      bytes.push(b);
      break;
    }
  }
  return new Uint8Array(bytes);
}

function encodeField(fieldNum: number, wireType: number, value: number | Uint8Array): Uint8Array {
  const key = (fieldNum << 3) | wireType;
  const keyBytes = encodeVarint(key);
  if (wireType === 0) {
    const valBytes = encodeVarint(value as number);
    const res = new Uint8Array(keyBytes.length + valBytes.length);
    res.set(keyBytes);
    res.set(valBytes, keyBytes.length);
    return res;
  } else if (wireType === 2) {
    const lenBytes = encodeVarint((value as Uint8Array).length);
    const res = new Uint8Array(keyBytes.length + lenBytes.length + (value as Uint8Array).length);
    res.set(keyBytes);
    res.set(lenBytes, keyBytes.length);
    res.set(value as Uint8Array, keyBytes.length + lenBytes.length);
    return res;
  }
  throw new Error('Unsupported wire type');
}

describe('AntigravitySource', () => {
  let tempDir: string;
  let oldHome: string | undefined;

  beforeAll(() => {
    oldHome = process.env.HOME;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-test-'));
    process.env.HOME = tempDir;

    // Create ~/.gemini/antigravity-cli/conversations
    const cliDir = path.join(tempDir, '.gemini/antigravity-cli');
    const convDir = path.join(cliDir, 'conversations');
    const implicitDir = path.join(cliDir, 'implicit');
    fs.mkdirSync(convDir, { recursive: true });
    fs.mkdirSync(implicitDir, { recursive: true });

    // 1. Write history.jsonl
    const historyFile = path.join(cliDir, 'history.jsonl');
    const historyData = [
      { conversationId: 'conv_1', workspace: '/Users/duet/project/myproj', timestamp: Date.now() },
      { conversationId: 'conv_pb', workspace: '/Users/duet/project/myproj-old', timestamp: Date.now() - 86400000 },
    ];
    fs.writeFileSync(historyFile, historyData.map(h => JSON.stringify(h)).join('\n'));

    // 2. Build protobuf mock bytes for exact SQL db record
    const promptField = encodeField(2, 0, 150);
    const compField = encodeField(3, 0, 45);
    const cachedField = encodeField(5, 0, 2000);
    const f4Inner = new Uint8Array(promptField.length + compField.length + cachedField.length);
    f4Inner.set(promptField, 0);
    f4Inner.set(compField, promptField.length);
    f4Inner.set(cachedField, promptField.length + compField.length);
    const f4 = encodeField(4, 2, f4Inner);

    const secondsField = encodeField(1, 0, Math.floor(Date.now() / 1000));
    const nanosField = encodeField(2, 0, 0);
    const f9_f4Inner = new Uint8Array(secondsField.length + nanosField.length);
    f9_f4Inner.set(secondsField, 0);
    f9_f4Inner.set(nanosField, secondsField.length);
    const f9_f4 = encodeField(4, 2, f9_f4Inner);
    const f9 = encodeField(9, 2, f9_f4);

    const modelNameField = encodeField(19, 2, new TextEncoder().encode('gemini-2.5-flash-test'));

    const f1Inner = new Uint8Array(f4.length + f9.length + modelNameField.length);
    let offset = 0;
    f1Inner.set(f4, offset); offset += f4.length;
    f1Inner.set(f9, offset); offset += f9.length;
    f1Inner.set(modelNameField, offset);
    const rootMsg = encodeField(1, 2, f1Inner);

    // 3. Create a real SQLite database for conv_1
    const dbPath = path.join(convDir, 'conv_1.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE gen_metadata (data BLOB)');
    const insert = db.prepare('INSERT INTO gen_metadata (data) VALUES (?)');
    insert.run(rootMsg);
    db.close();

    // 4. Create dummy encrypted .pb conversation to trigger estimation logic
    fs.writeFileSync(path.join(convDir, 'conv_pb.pb'), 'mock-encrypted-pb-data');

    // 5. Create implicit .pb subagent log to trigger implicit estimation logic
    // (1 MB implicit pb size produces 500K tokens and 9.6M cached)
    const implicitBytes = new Uint8Array(1024 * 1024); // 1 MB
    fs.writeFileSync(path.join(implicitDir, 'subagent_1.pb'), implicitBytes);
  });

  afterAll(() => {
    process.env.HOME = oldHome;
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('correctly reads, parses, and estimates Antigravity tokens', async () => {
    const source = new AntigravitySource({ machineName: 'test-mac', hashProjects: false, verbose: true });
    const result = await source.fetch();

    expect(result.sourceName).toBe('antigravity');
    const events = result.data.events;
    
    // We expect:
    // - conv_1.db -> 1 daily row, 1 session row
    // - conv_pb.pb -> 1 daily row, 1 session row (estimated)
    // - implicit subagents -> 1 daily row
    expect(events.length).toBeGreaterThanOrEqual(4);

    // Verify exact SQLite DB parsed event
    const dbDaily = events.find(e => e.record_type === 'daily' && e.model_name === 'gemini-2.5-flash-test');
    expect(dbDaily).toBeDefined();
    expect(dbDaily?.input_tokens).toBe(150);
    expect(dbDaily?.output_tokens).toBe(45);
    expect(dbDaily?.cache_read_tokens).toBe(2000);
    expect(dbDaily?.total_tokens).toBe(150 + 45 + 2000);

    const dbSession = events.find(e => e.record_type === 'session' && e.model_name === 'gemini-2.5-flash-test');
    expect(dbSession).toBeDefined();
    expect(dbSession?.input_tokens).toBe(150);
    expect(dbSession?.output_tokens).toBe(45);

    // Verify estimated PB conversation event
    const pbDaily = events.find(e => e.record_type === 'daily' && e.model_name === 'gemini-3.5-flash-medium' && e.project_path.includes('myproj-old'));
    expect(pbDaily).toBeDefined();
    expect(pbDaily?.input_tokens).toBe(198705); // EST_PROMPT_TOKENS
    expect(pbDaily?.output_tokens).toBe(11990); // EST_COMP_TOKENS
    expect(pbDaily?.cache_read_tokens).toBe(4075117); // EST_CACHED_TOKENS

    // Verify implicit subagents event
    const implicitDaily = events.find(e => e.record_type === 'daily' && e.project_path.includes('implicit-subagents'));
    expect(implicitDaily).toBeDefined();
    expect(implicitDaily?.input_tokens).toBeCloseTo(470000, -4); // ~94% of 500K tokens
    expect(implicitDaily?.cache_read_tokens).toBeCloseTo(9600000, -5); // ~9.6M
  });
});
