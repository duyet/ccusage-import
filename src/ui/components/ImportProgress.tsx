/**
 * Import Progress Component
 *
 * Animated progress indicator for the 3-step ccusage import process.
 * Features Unicode Braille spinners, step-by-step tracking, and real-time status.
 *
 * Steps:
 * 1. Fetch - Parallel fetching of 5 ccusage data sources (daily, monthly, session, blocks, projects)
 * 2. Process - Parsing, validation, and ClickHouse data insertion
 * 3. Analyze - Statistics generation and analytics
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';

/**
 * Progress step type
 */
export type ImportStep = 'fetch' | 'process' | 'analyze' | 'complete';

/**
 * Sub-step for fetch phase
 */
export interface FetchSubStep {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  duration?: number;
  recordCount?: number;
}

/**
 * Import progress state
 */
export interface ImportProgressState {
  step: ImportStep;
  fetchProgress: {
    current: number;
    total: number;
    subSteps: FetchSubStep[];
  };
  processProgress: {
    current: number;
    total: number;
    message: string;
  };
  analyzeProgress: {
    current: number;
    total: number;
    message: string;
  };
}

/**
 * Component props
 */
export interface ImportProgressProps {
  state: ImportProgressState;
  onComplete?: () => void;
}

/**
 * Unicode Braille spinner frames (from Python reference)
 * Pattern: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/**
 * Step configuration with icons and descriptions
 */
const STEP_CONFIG = {
  fetch: {
    icon: '1️⃣',
    label: 'Fetch',
    description: 'Fetching data from ccusage',
  },
  process: {
    icon: '2️⃣',
    label: 'Process',
    description: 'Processing and importing data',
  },
  analyze: {
    icon: '3️⃣',
    label: 'Analyze',
    description: 'Generating analytics',
  },
  complete: {
    icon: '✅',
    label: 'Complete',
    description: 'Import finished successfully',
  },
} as const;

/**
 * Main Import Progress Component
 */
export function ImportProgress({ state, onComplete }: ImportProgressProps) {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Animate spinner at 100ms intervals (matching Python reference)
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Call onComplete when step becomes 'complete'
  useEffect(() => {
    if (state.step === 'complete' && onComplete) {
      onComplete();
    }
  }, [state.step, onComplete]);

  /**
   * Render the animated spinner
   */
  const renderSpinner = () => SPINNER_FRAMES[spinnerFrame];

  /**
   * Render fetch sub-steps with progress indicators
   */
  const renderFetchSubSteps = useCallback(() => {
    const { subSteps, current, total } = state.fetchProgress;

    return subSteps.map((subStep) => {
      const { id, label, status, duration, recordCount } = subStep;

      let icon: string;
      let color: string;

      switch (status) {
        case 'complete':
          icon = '✓';
          color = '#4ade80';
          break;
        case 'in-progress':
          icon = renderSpinner();
          color = '#fbbf24';
          break;
        case 'error':
          icon = '✗';
          color = '#ef4444';
          break;
        default:
          icon = '○';
          color = '#6b7280';
      }

      const durationText = duration ? ` (${duration.toFixed(1)}s)` : '';
      const recordText = recordCount ? ` - ${recordCount} records` : '';
      const progressText = status === 'complete' ? ` (${current}/${total})` : '';

      return (
        <Box key={id} marginLeft={2}>
          <Text color={color}>
            {icon} {label}{durationText}{recordText}{progressText}
          </Text>
        </Box>
      );
    });
  }, [state.fetchProgress, spinnerFrame]);

  /**
   * Render process step with progress
   */
  const renderProcessStep = useCallback(() => {
    const { current, total, message } = state.processProgress;
    const isActive = state.step === 'process';

    return (
      <Box flexDirection="column" gap={1}>
        <Box marginLeft={2}>
          <Text color={isActive ? '#fbbf24' : '#6b7280'}>
            {isActive ? renderSpinner() : '○'} {message} ({current}/{total})
          </Text>
        </Box>
      </Box>
    );
  }, [state.processProgress, state.step, spinnerFrame]);

  /**
   * Render analyze step with progress
   */
  const renderAnalyzeStep = useCallback(() => {
    const { current, total, message } = state.analyzeProgress;
    const isActive = state.step === 'analyze';

    return (
      <Box flexDirection="column" gap={1}>
        <Box marginLeft={2}>
          <Text color={isActive ? '#fbbf24' : '#6b7280'}>
            {isActive ? renderSpinner() : '○'} {message} ({current}/{total})
          </Text>
        </Box>
      </Box>
    );
  }, [state.analyzeProgress, state.step, spinnerFrame]);

  /**
   * Render step header
   */
  const renderStepHeader = useCallback(() => {
    const config = STEP_CONFIG[state.step];
    const isComplete = state.step === 'complete';

    return (
      <Box marginBottom={1}>
        <Text bold color={isComplete ? '#4ade80' : '#fbbf24'}>
          {isComplete ? '✅' : renderSpinner()} {config.icon} {config.label}
        </Text>
        <Text dimColor color="#9ca3af"> - {config.description}</Text>
      </Box>
    );
  }, [state.step, spinnerFrame]);

  return (
    <Box flexDirection="column" gap={1}>
      {/* Step Header */}
      {renderStepHeader()}

      {/* Fetch Step Details */}
      {state.step === 'fetch' && (
        <Box flexDirection="column" gap={1}>
          {renderFetchSubSteps()}
        </Box>
      )}

      {/* Process Step Details */}
      {(state.step === 'process' || state.step === 'analyze' || state.step === 'complete') && (
        <Box flexDirection="column" gap={1}>
          <Box marginLeft={2}>
            <Text color="#4ade80">✓ Fetch data from ccusage (5/5)</Text>
          </Box>
          {state.step !== 'complete' && renderProcessStep()}
        </Box>
      )}

      {/* Analyze Step Details */}
      {(state.step === 'analyze' || state.step === 'complete') && (
        <Box flexDirection="column" gap={1}>
          <Box marginLeft={2}>
            <Text color="#4ade80">✓ Process and validate data</Text>
          </Box>
          {state.step !== 'complete' && renderAnalyzeStep()}
        </Box>
      )}

      {/* Complete Step */}
      {state.step === 'complete' && (
        <Box flexDirection="column" gap={1}>
          <Box marginLeft={2}>
            <Text color="#4ade80">✓ Generate statistics and analytics</Text>
          </Box>
          <Box marginTop={1}>
            <Text bold color="#4ade80">Import completed successfully!</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Hook to manage import progress state
 */
export function useImportProgress() {
  const [state, setState] = useState<ImportProgressState>({
    step: 'fetch',
    fetchProgress: {
      current: 0,
      total: 5,
      subSteps: [
        { id: 'daily', label: 'daily data', status: 'pending' },
        { id: 'monthly', label: 'monthly data', status: 'pending' },
        { id: 'session', label: 'session data', status: 'pending' },
        { id: 'blocks', label: 'blocks data', status: 'pending' },
        { id: 'projects', label: 'projects data', status: 'pending' },
      ],
    },
    processProgress: {
      current: 0,
      total: 7,
      message: 'Parsing data structures',
    },
    analyzeProgress: {
      current: 0,
      total: 3,
      message: 'Calculating statistics',
    },
  });

  /**
   * Update fetch sub-step status
   */
  const updateFetchSubStep = useCallback(
    (id: string, status: FetchSubStep['status'], duration?: number, recordCount?: number) => {
      setState(prev => {
        const subSteps = prev.fetchProgress.subSteps.map(step =>
          step.id === id
            ? { ...step, status, duration, recordCount }
            : step
        );

        const completeCount = subSteps.filter(s => s.status === 'complete').length;

        return {
          ...prev,
          fetchProgress: {
            ...prev.fetchProgress,
            subSteps,
            current: completeCount,
          },
          step: completeCount === 5 ? 'process' : 'fetch',
        };
      });
    },
    []
  );

  /**
   * Update process progress
   */
  const updateProcessProgress = useCallback((current: number, message: string) => {
    setState(prev => ({
      ...prev,
      processProgress: {
        ...prev.processProgress,
        current,
        message,
      },
      step: current === prev.processProgress.total ? 'analyze' : 'process',
    }));
  }, []);

  /**
   * Update analyze progress
   */
  const updateAnalyzeProgress = useCallback((current: number, message: string) => {
    setState(prev => ({
      ...prev,
      analyzeProgress: {
        ...prev.analyzeProgress,
        current,
        message,
      },
      step: current === prev.analyzeProgress.total ? 'complete' : 'analyze',
    }));
  }, []);

  /**
   * Reset progress to initial state
   */
  const reset = useCallback(() => {
    setState({
      step: 'fetch',
      fetchProgress: {
        current: 0,
        total: 5,
        subSteps: [
          { id: 'daily', label: 'daily data', status: 'pending' },
          { id: 'monthly', label: 'monthly data', status: 'pending' },
          { id: 'session', label: 'session data', status: 'pending' },
          { id: 'blocks', label: 'blocks data', status: 'pending' },
          { id: 'projects', label: 'projects data', status: 'pending' },
        ],
      },
      processProgress: {
        current: 0,
        total: 7,
        message: 'Parsing data structures',
      },
      analyzeProgress: {
        current: 0,
        total: 3,
        message: 'Calculating statistics',
      },
    });
  }, []);

  return {
    state,
    updateFetchSubStep,
    updateProcessProgress,
    updateAnalyzeProgress,
    reset,
  };
}
