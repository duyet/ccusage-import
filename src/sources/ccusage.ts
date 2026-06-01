/**
 * Ccusage Source
 *
 * Fetches all data types from ccusage CLI in parallel,
 * parses into flat event rows for the single ccusage_events table.
 */

import { fetchAllCcusageData } from '../fetchers/ccusage.js';
import { buildCcusageEventRows } from '../parsers/parsers.js';
import { TIMEOUTS } from '../constants.js';
import type { DataSource, SourceResult, EventsSnapshotData } from '../pipeline/types.js';

export interface CcusageSourceOptions {
  machineName: string;
  hashProjects?: boolean;
  timeout?: number;
  verbose?: boolean;
  daysBack?: number;
  since?: string;
  endDate?: string;
  importId?: string;
}

export class CcusageSource implements DataSource {
  readonly name = 'ccusage';
  private opts: CcusageSourceOptions;

  constructor(opts: CcusageSourceOptions) {
    this.opts = opts;
  }

  async fetch(): Promise<SourceResult> {
    const { machineName, hashProjects = true, timeout = TIMEOUTS.ccusage, verbose, daysBack, since, endDate, importId = '' } = this.opts;
    // Compute since from daysBack if not explicitly provided
    let effectiveSince = since;
    if (!effectiveSince && daysBack != null && daysBack > 0) {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      effectiveSince = d.toISOString().split('T')[0];
    }
    const raw = await fetchAllCcusageData({ verbose, timeout, since: effectiveSince, endDate });
    const events = buildCcusageEventRows(raw, machineName, hashProjects, importId);
    const data: EventsSnapshotData = { events };
    return { sourceName: this.name, data, fetchedAt: new Date() };
  }
}
