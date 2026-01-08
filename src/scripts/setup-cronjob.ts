#!/usr/bin/env node
/**
 * Cronjob Setup Script (TypeScript)
 *
 * Sets up automated hourly imports for ccusage-import
 *
 * Usage:
 *   bun run setup-cronjob           # Interactive setup
 *   bun run setup-cronjob -f        # Force overwrite
 *   bun run setup-cronjob -s        # Show status
 *   bun run setup-cronjob -h        # Show help
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';

// Get current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface Options {
  force?: boolean;
  status?: boolean;
  help?: boolean;
}

interface CronEntry {
  schedule: string;
  command: string;
}

// Constants
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(PROJECT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'ccusage-import.log');
const LOGROTATE_CONF = path.join(PROJECT_DIR, 'logrotate.conf');
const LOGROTATE_STATUS = path.join(PROJECT_DIR, 'logrotate.status');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function log(color: string, emoji: string, message: string) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

function error(message: string) {
  log(colors.red, '❌', message);
}

function success(message: string) {
  log(colors.green, '✅', message);
}

function warn(message: string) {
  log(colors.yellow, '⚠️', message);
}

function info(message: string) {
  log(colors.blue, 'ℹ️', message);
}

/**
 * Detect shell and config file
 */
function detectShellConfig(): string {
  const shell = process.env.SHELL || '';
  const shellName = path.basename(shell);

  switch (shellName) {
    case 'bash':
      return path.join(os.homedir(), '.bashrc');
    case 'zsh':
      return path.join(os.homedir(), '.zshrc');
    case 'fish':
      return path.join(os.homedir(), '.config/fish/config.fish');
    default:
      return path.join(os.homedir(), '.profile');
  }
}

/**
 * Detect Node.js runtime
 */
function detectRuntime(): 'bun' | 'node' {
  // Check if bun is available
  try {
    execSync('which bun', { stdio: 'ignore' });
    return 'bun';
  } catch {
    return 'node';
  }
}

/**
 * Get current crontab entries
 */
function getCrontab(): string[] {
  try {
    const result = execSync('crontab -l', { encoding: 'utf-8', stdio: 'pipe' });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Set crontab entries
 */
function setCrontab(entries: string[]): void {
  const content = entries.join('\n');
  execSync(`echo '${content}' | crontab -`, { stdio: 'pipe' });
}

/**
 * Check if environment variables are set
 */
function checkEnvironment(): boolean {
  const required = ['CH_HOST', 'CH_USER', 'CH_PASSWORD', 'CH_DATABASE'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.log('');
    warn('ClickHouse environment variables not set!');
    console.log('');
    console.log('Please set them first:');
    console.log(`  export CH_HOST='your-host'`);
    console.log(`  export CH_PORT='8123'`);
    console.log(`  export CH_USER='your-user'`);
    console.log(`  export CH_PASSWORD='your-password'`);
    console.log(`  export CH_DATABASE='your-database'`);
    console.log('');

    const configFile = detectShellConfig();
    console.log(`Then add them to ${configFile} for persistence.`);
    console.log('');

    return false;
  }

  return true;
}

/**
 * Get PATH for cron
 */
function getCronPath(): string {
  const paths = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    path.join(os.homedir(), '.local/bin'),
  ];

  const bunBin = path.join(os.homedir(), '.bun', 'bin');
  if (existsSync(bunBin)) {
    paths.unshift(bunBin);
  }

  return paths.join(':');
}

/**
 * Build cron entry
 */
function buildCronEntry(runtime: 'bun' | 'node'): string {
  const cronPath = getCronPath();
  const cliPath = path.join(PROJECT_DIR, 'src', 'cli.ts');

  return `0 * * * * PATH="${cronPath}" cd "${PROJECT_DIR}" && ${runtime} run "${cliPath}" import --quiet >> "${LOG_FILE}" 2>&1`;
}

/**
 * Show current cronjob status
 */
async function showStatus(): Promise<void> {
  console.log('📊 Current cronjob status:\n');

  const crontab = getCrontab();
  const ccusageEntries = crontab.filter(line => line.includes('ccusage-import'));

  if (ccusageEntries.length > 0) {
    success('ccusage-import cronjob(s) installed:');
    console.log('');
    for (const entry of ccusageEntries) {
      console.log(`  ${entry}`);
    }
    console.log('');

    // Show log file info
    console.log(`📝 Log file: ${LOG_FILE}`);

    if (existsSync(LOG_FILE)) {
      const logContent = await readFile(LOG_FILE, 'utf-8');
      const lines = logContent.split('\n').filter(Boolean);
      console.log(`📊 Log size: ${lines.length} lines`);

      if (lines.length > 0) {
        console.log('🕒 Last 3 entries:');
        for (const line of lines.slice(-3)) {
          console.log(`    ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
        }
      }
    }
  } else {
    warn('No ccusage-import cronjob found');
    console.log('');
    console.log(`To install, run: bun run setup-cronjob`);
  }

  process.exit(0);
}

/**
 * Install cronjob
 */
async function installCronjob(options: Options): Promise<void> {
  console.log('⏰ Setting up ccusage-import cronjob...\n');

  const configFile = detectShellConfig();
  info(`Project directory: ${PROJECT_DIR}`);
  info(`Shell config: ${configFile}\n`);

  // Check environment
  if (!checkEnvironment()) {
    const answer = prompt('Continue anyway? (y/N): ');
    if (answer?.toLowerCase() !== 'y') {
      process.exit(1);
    }
  }

  // Detect runtime
  const runtime = await detectRuntime();
  success(`Detected ${runtime} runtime`);

  // Create log directory
  await mkdir(LOG_DIR, { recursive: true });
  info(`Log file: ${LOG_FILE}\n`);

  // Build cron entry
  const cronEntry = await buildCronEntry(runtime);

  console.log('Cron entry to be added:');
  console.log(`  ${cronEntry}\n`);

  // Get current crontab
  let crontab = await getCrontab();

  // Filter out existing ccusage-import entries
  const existingEntries = crontab.filter(line => line.includes('ccusage-import'));

  if (existingEntries.length > 0) {
    warn('Found existing ccusage-import cronjob(s)');

    if (options.force) {
      info('Force mode: replacing existing cronjob(s)');
      crontab = crontab.filter(line => !line.includes('ccusage-import'));
      crontab.push(cronEntry);
      await setCrontab(crontab);
      success('Cronjob updated');
    } else {
      const answer = prompt('Replace it? (y/N): ');
      if (answer?.toLowerCase() === 'y') {
        crontab = crontab.filter(line => !line.includes('ccusage-import'));
        crontab.push(cronEntry);
        await setCrontab(crontab);
        success('Cronjob updated');
      } else {
        info('Skipped cronjob setup');
        process.exit(0);
      }
    }
  } else {
    crontab.push(cronEntry);
    await setCrontab(crontab);
    success('Cronjob installed');
  }

  // Create logrotate config
  const logrotateConf = `${LOG_FILE} {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 ${os.userInfo().username} ${os.userInfo().username}
}
`;

  await writeFile(LOGROTATE_CONF, logrotateConf);
  success(`Created logrotate config: ${LOGROTATE_CONF}`);

  // Add logrotate cronjob if not exists
  const logrotateEntry = `0 0 * * * /usr/sbin/logrotate -s "${LOGROTATE_STATUS}" "${LOGROTATE_CONF}" >> "${LOG_FILE}" 2>&1`;

  if (!crontab.some(line => line.includes('logrotate') && line.includes('ccusage-import'))) {
    crontab.push(logrotateEntry);
    await setCrontab(crontab);
    success('Log rotation cronjob added');
  }

  console.log('');
  success('Setup complete!');
  console.log('');
  console.log('Your import will run hourly. View logs with:');
  console.log(`  tail -f ${LOG_FILE}`);
  console.log('');
  console.log('To list cronjobs:');
  console.log('  crontab -l');
  console.log('');
  console.log('To show status:');
  console.log('  bun run setup-cronjob -s');
  console.log('');
  console.log('To remove the cronjob:');
  console.log('  crontab -e   # and delete the ccusage-import lines');
}

/**
 * Show help
 */
function showHelp(): void {
  console.log('ccusage-import Cronjob Setup\n');
  console.log('Usage: bun run setup-cronjob [OPTIONS]\n');
  console.log('Options:');
  console.log('  -f, --force      Force overwrite existing cronjob without prompting');
  console.log('  -s, --status     Show current cronjob status and exit');
  console.log('  -h, --help       Show this help message\n');
  console.log('Examples:');
  console.log('  bun run setup-cronjob           # Interactive setup');
  console.log('  bun run setup-cronjob -f        # Force overwrite');
  console.log('  bun run setup-cronjob -s        # Show status\n');
  process.exit(0);
}

/**
 * Simple prompt (for non-interactive use)
 */
function prompt(question: string): string | undefined {
  if (process.stdin.isTTY) {
    process.stdout.write(question);
    const fs = require('fs');
    const fd = fs.openSync('/dev/stdin', 'r');
    const buffer = Buffer.alloc(1024);
    const n = fs.readSync(fd, buffer, 0, 1024, null);
    fs.closeSync(fd);
    return buffer.toString('utf8', 0, n).trim();
  }
  return undefined;
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const options: Options = {};

  for (const arg of args) {
    switch (arg) {
      case '-f':
      case '--force':
        options.force = true;
        break;
      case '-s':
      case '--status':
        options.status = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        error(`Unknown option: ${arg}`);
        console.log('Usage: bun run setup-cronjob [-f|--force] [-s|--status] [-h|--help]');
        process.exit(1);
    }
  }

  if (options.help) {
    showHelp();
  }

  if (options.status) {
    await showStatus();
  }

  await installCronjob(options);
}

main().catch(err => {
  error(`Failed: ${err.message}`);
  process.exit(1);
});
