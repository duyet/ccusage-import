/**
 * OpenCode Data Fetcher
 *
 * Fetches and parses OpenCode message store data from JSONL files.
 * Uses Bun.file() API for efficient file reading and Zod for validation.
 */

import { OpenCodeMessageSchema, type OpenCodeMessage } from '../types/schemas.js';

/**
 * Error thrown when OpenCode data fetching fails
 */
export class FetchError extends Error {
  constructor(
    public readonly source: string,
    public readonly command: string,
    message: string
  ) {
    super(`${source} fetch error for '${command}': ${message}`);
    this.name = 'FetchError';
  }
}

/**
 * Default OpenCode storage path
 */
const DEFAULT_OPENCODE_PATH = `${process.env.HOME}/.local/share/opencode/storage/message`;

/**
 * OpenCodeFetcher class for reading OpenCode message data
 *
 * Supports both single messages.jsonl file and messages/ directory
 * with multiple JSONL files.
 */
export class OpenCodeFetcher {
  private readonly opencodePath: string;

  /**
   * Create an OpenCode fetcher instance
   *
   * @param path - Path to OpenCode data directory (defaults to ~/.local/share/opencode/storage/message)
   */
  constructor(path?: string) {
    this.opencodePath = path || DEFAULT_OPENCODE_PATH;
  }

  /**
   * Fetch all messages from OpenCode store
   *
   * Attempts to read from:
   * 1. {path}/messages.jsonl - Single file with all messages
   * 2. {path}/messages/ - Directory with multiple JSONL files
   *
   * @returns Promise resolving to array of validated OpenCode messages
   * @throws {FetchError} If path is invalid or messages cannot be loaded
   */
  async fetchMessages(): Promise<OpenCodeMessage[]> {
    const messagesFilePath = `${this.opencodePath}/messages.jsonl`;
    const messagesDirPath = `${this.opencodePath}/messages`;

    // Try messages.jsonl file first
    try {
      const file = Bun.file(messagesFilePath);
      if (file.size > 0) {
        return await this.loadJSONL(messagesFilePath);
      }
    } catch (error) {
      // File doesn't exist, try directory
    }

    // Try messages directory
    try {
      const dirExists = await this.directoryExists(messagesDirPath);
      if (dirExists) {
        return await this.loadMessagesDirectory(messagesDirPath);
      }
    } catch (error) {
      // Directory doesn't exist
    }

    // Neither file nor directory found
    throw new FetchError(
      'opencode',
      'messages',
      `No messages found at: ${this.opencodePath} ` +
      `(expected messages.jsonl or messages/ directory)`
    );
  }

  /**
   * Load messages from a single JSONL file
   *
   * Each line is a JSON object representing an API interaction.
   *
   * @param filePath - Absolute path to JSONL file
   * @returns Promise resolving to array of validated OpenCode messages
   * @throws {FetchError} If file cannot be read
   */
  private async loadJSONL(filePath: string): Promise<OpenCodeMessage[]> {
    const messages: OpenCodeMessage[] = [];

    try {
      const file = Bun.file(filePath);
      const text = await file.text();
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          const validated = OpenCodeMessageSchema.parse(data);
          messages.push(validated);
        } catch (error) {
          // Log warning but continue processing other lines
          if (error instanceof Error) {
            console.warn(`Failed to parse message line: ${error.message}`);
          }
        }
      }

      console.log(`Loaded ${messages.length} messages from ${filePath}`);
      return messages;
    } catch (error) {
      throw new FetchError(
        'opencode',
        'messages',
        `Failed to read messages file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load messages from a directory containing multiple JSONL files
   *
   * @param dirPath - Absolute path to messages directory
   * @returns Promise resolving to array of validated OpenCode messages
   */
  private async loadMessagesDirectory(dirPath: string): Promise<OpenCodeMessage[]> {
    const allMessages: OpenCodeMessage[] = [];

    try {
      // Use Bun's shell to list JSONL files
      const result = await Bun.spawn(['ls', '-1', dirPath]).exited;
      const files = await Bun.file(`${dirPath}/*.jsonl`).text();

      // Read directory contents using Node.js fs
      const fs = await import('fs/promises');
      const entries = await fs.readdir(dirPath);
      const jsonlFiles = entries.filter(file => file.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        try {
          const messages = await this.loadJSONL(`${dirPath}/${file}`);
          allMessages.push(...messages);
        } catch (error) {
          // Log warning but continue with other files
          if (error instanceof Error) {
            console.warn(`Failed to load ${file}: ${error.message}`);
          }
        }
      }

      console.log(`Loaded ${allMessages.length} messages from ${dirPath}`);
      return allMessages;
    } catch (error) {
      throw new FetchError(
        'opencode',
        'messages',
        `Failed to read messages directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a directory exists
   *
   * @param path - Directory path to check
   * @returns Promise resolving to true if directory exists
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      const stat = await fs.stat(path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if the configured OpenCode path is valid
   *
   * @returns Promise resolving to true if path contains messages
   */
  async checkPath(): Promise<boolean> {
    const messagesFilePath = `${this.opencodePath}/messages.jsonl`;
    const messagesDirPath = `${this.opencodePath}/messages`;

    // Check for file
    try {
      const file = Bun.file(messagesFilePath);
      if (file.size > 0) {
        return true;
      }
    } catch {
      // File doesn't exist
    }

    // Check for directory
    return await this.directoryExists(messagesDirPath);
  }
}

/**
 * Convenience function to fetch OpenCode messages
 *
 * @param options - Fetch options
 * @returns Promise resolving to array of OpenCode messages
 */
export async function fetchOpenCodeMessages(options: {
  opencodePath?: string;
  verbose?: boolean;
}): Promise<OpenCodeMessage[]> {
  const fetcher = new OpenCodeFetcher(options.opencodePath ?? '');
  return await fetcher.fetchMessages();
}

/**
 * Convenience function to check OpenCode path
 *
 * @param opencodePath - Path to OpenCode data directory
 * @returns Promise resolving to true if path is valid
 */
export async function checkOpenCodePath(opencodePath: string): Promise<boolean> {
  const fetcher = new OpenCodeFetcher(opencodePath);
  return await fetcher.checkPath();
}
