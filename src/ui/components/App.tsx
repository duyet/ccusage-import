/**
 * Main App Component
 *
 * Root component that orchestrates the ccusage-import CLI interface.
 * TTY-aware: renders beautiful Ink UI when in terminal, outputs JSON when in cron/piped mode.
 * Handles state management for the import process and renders appropriate views.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, render, StdinContext } from 'ink';
import type { Stdin } from 'ink';

import { hasTTY } from '../utils/tty.js';
import { ImportProgress } from './ImportProgress.js';
import { StatisticsDashboard } from './StatisticsDashboard.js';
import { UsageHeatmap } from './UsageHeatmap.js';
import { type ImportState, type ImportStats, initialImportState } from '../types/index.js';

interface AppProps {
  onImport: () => Promise<ImportStats>;
  verbose?: boolean;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * TTY-aware App component that adapts output based on terminal detection
 */
export function App({ onImport, verbose = false }: AppProps) {
  const [importState, setImportState] = useState<ImportState>(initialImportState);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isTTY, setIsTTY] = useState<boolean>(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const importStartTime = useRef<Date>(new Date());

  const totalSteps = 5;
  const steps = [
    { key: 'daily', label: 'Daily data' },
    { key: 'monthly', label: 'Monthly data' },
    { key: 'session', label: 'Sessions' },
    { key: 'blocks', label: 'Billing blocks' },
    { key: 'projects', label: 'Projects' },
  ];

  /**
   * Detect TTY on mount and set mode accordingly
   */
  useEffect(() => {
    const ttyDetected = hasTTY();
    setIsTTY(ttyDetected);

    // Log TTY detection
    addLog('info', 'init', `TTY ${ttyDetected ? 'detected' : 'not detected'} - ${ttyDetected ? 'interactive mode' : 'cron/log mode'}`);

    // If not TTY, output initial JSON marker
    if (!ttyDetected) {
      console.log(JSON.stringify({
        type: 'import_start',
        timestamp: new Date().toISOString(),
        mode: 'non-interactive',
        verbose
      }));
    }
  }, [verbose]);

  /**
   * Add log entry (used in both TTY and non-TTY modes)
   */
  const addLog = useCallback((level: LogEntry['level'], step: string, message: string, data?: Record<string, unknown>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      step,
      message,
      data
    };

    setLogs(prev => [...prev, entry]);

    // In non-TTY mode, output JSON immediately
    if (!isTTY) {
      console.log(JSON.stringify({ type: 'log', ...entry }));
    }
  }, [isTTY]);

  const startImport = useCallback(async () => {
    setImportState({ status: 'running', step: 'fetching', progress: 0 });
    setCurrentStep(0);
    addLog('info', 'import', 'Starting import process');

    try {
      // Fetching phase
      addLog('info', 'fetching', 'Fetching data from ccusage CLI');

      for (let i = 0; i < totalSteps; i++) {
        setCurrentStep(i);
        setImportState({
          status: 'running',
          step: 'fetching',
          progress: (i / totalSteps) * 100,
        });

        const stepInfo = steps[i];
        addLog('info', 'fetching', `Fetching ${stepInfo.label}... (${i + 1}/${totalSteps})`, {
          step: stepInfo.key,
          progress: Math.round(((i + 1) / totalSteps) * 100)
        });

        // Simulate delay (replace with actual fetch logic)
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Processing phase
      addLog('info', 'processing', 'Processing and importing data to ClickHouse');
      setImportState({ status: 'running', step: 'processing', progress: 80 });

      await new Promise(resolve => setTimeout(resolve, 600));

      // Execute actual import
      addLog('info', 'import', 'Executing data import');
      const result = await onImport();

      setStats(result);
      setImportState({ status: 'complete', step: 'done', progress: 100 });

      const duration = Date.now() - importStartTime.current.getTime();
      addLog('success', 'complete', `Import completed successfully`, {
        duration: `${duration}ms`,
        tables: Object.keys(result.tableCounts || {}).length
      });

      // In non-TTY mode, output final results as JSON
      if (!isTTY) {
        console.log(JSON.stringify({
          type: 'import_complete',
          timestamp: new Date().toISOString(),
          duration,
          stats: {
            tableCounts: result.tableCounts,
            costBySource: result.costBySource,
            tokenConsumption: result.tokenConsumption,
            modelRankings: result.modelRankings,
            activeBlocksCount: result.activeBlocks?.length || 0
          }
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setImportState({
        status: 'error',
        step: 'failed',
        error: errorMessage,
        progress: 0,
      });

      addLog('error', 'failed', `Import failed: ${errorMessage}`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });

      // In non-TTY mode, output error as JSON
      if (!isTTY) {
        console.log(JSON.stringify({
          type: 'import_error',
          timestamp: new Date().toISOString(),
          error: errorMessage,
          logs
        }));
      }
    }
  }, [onImport, addLog, isTTY, totalSteps, steps]);

  useEffect(() => {
    startImport();
  }, [startImport]);

  /**
   * Non-TTY mode: Return null (all output via console.log JSON)
   */
  if (!isTTY) {
    return null;
  }

  /**
   * TTY Mode: Render beautiful Ink UI
   */

  // Error state
  if (importState.status === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Box>
          <Text color="#ff6b6b" bold>
            Import failed
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{importState.error}</Text>
        </Box>
        {verbose && logs.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Recent logs:</Text>
            {logs.slice(-3).map((log, idx) => (
              <Box key={idx}>
                <Text dimColor>
                  [{log.timestamp}] {log.level.toUpperCase()}: {log.message}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Complete state with statistics
  if (importState.status === 'complete' && stats) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <StatisticsDashboard stats={stats} />
        {stats.dailyData && stats.dailyData.length > 0 && (
          <UsageHeatmap dailyData={stats.dailyData} />
        )}
      </Box>
    );
  }

  // Running state with progress
  return (
    <Box flexDirection="column" paddingX={1}>
      <ImportProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        steps={steps}
        progress={importState.progress}
        step={importState.step}
      />
      {verbose && importState.step === 'fetching' && (
        <Box marginTop={1}>
          <Text dimColor>Fetching data from ccusage CLI...</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Render the app to terminal with TTY detection
 */
export async function runCLI(onImport: () => Promise<ImportStats>, verbose = false) {
  const { waitUntilExit } = render(<App onImport={onImport} verbose={verbose} />);
  await waitUntilExit();
}
