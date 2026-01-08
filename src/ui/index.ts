/**
 * UI Module Export
 *
 * Central export point for the entire UI system.
 */

export * from './components/index.js';
export * from './types/index.js';
export * from './utils/index.js';

// Re-export commonly used items at top level
export { default as Ink } from 'ink';
export { Text, Box, render } from 'ink';
