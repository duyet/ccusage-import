/**
 * Type definitions for UI components
 */

export interface ImportState {
  status: 'idle' | 'running' | 'complete' | 'error';
  step: 'fetching' | 'processing' | 'done' | 'failed';
  progress: number;
  error?: string;
}

export interface ImportStats {
  tableCounts: Record<string, number | Record<string, number>>;
  costBySource: Record<string, number>;
  tokenConsumption: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  modelRankings: Array<{
    modelName: string;
    cost: number;
    totalTokens: number;
  }>;
  activeBlocks: Array<{
    blockId: string;
    endTime: string;
    cost: number;
  }>;
  dailyData?: DailyUsageData[];
}

export interface DailyUsageData {
  date: string;
  totalCost: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export const initialImportState: ImportState = {
  status: 'idle',
  step: 'fetching',
  progress: 0,
};
