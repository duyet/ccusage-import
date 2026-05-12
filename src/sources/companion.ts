/**
 * Companion Source (Codex / OpenCode)
 *
 * Fetches data from @ccusage/codex or @ccusage/opencode companion packages,
 * parses into flat event rows for the single ccusage_events table.
 */

import { fetchAllCompanionData, type CompanionSource } from '../fetchers/companion.js';
import { buildCompanionEventRows } from '../parsers/parsers.js';
import type { DataSource, SourceResult, EventsSnapshotData } from '../pipeline/types.js';

export interface CompanionSourceOptions {
  type: CompanionSource;
  machineName: string;
  hashProjects?: boolean;
  timeout?: number;
  verbose?: boolean;
  dataPath?: string;
}

export class CompanionDataSource implements DataSource {
  readonly name: string;
  private opts: CompanionSourceOptions;

  constructor(opts: CompanionSourceOptions) {
    this.opts = opts;
    this.name = opts.type;
  }

  async fetch(): Promise<SourceResult> {
    const { type, machineName, hashProjects = true, timeout = 120_000, verbose, dataPath } = this.opts;
    const raw = await fetchAllCompanionData(type, { verbose, timeout, dataPath });
    const events = buildCompanionEventRows(raw, machineName, type, hashProjects);
    const data: EventsSnapshotData = { events };
    return { sourceName: this.name, data, fetchedAt: new Date() };
  }
}
