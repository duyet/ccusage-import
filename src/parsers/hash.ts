/**
 * SHA-256 project name hashing for privacy protection.
 *
 * This module provides stable, short hashes of project paths and session IDs
 * to protect user privacy in shared/corporate environments.
 */

import { createHash } from "node:crypto";

/**
 * Creates a stable, short hash of project paths for privacy.
 *
 * Uses SHA-256 to create an 8-character hexadecimal hash that is:
 * - Stable: Same input always produces the same output
 * - Collision-resistant: ~4 billion possible values (16^8)
 * - Privacy-preserving: Original paths cannot be reverse-engineered
 * - Short: 8 characters instead of full paths like "/home/user/project/very-long-name"
 *
 * @param projectPath - Full project path or session ID to hash
 * @param enabled - Whether hashing is enabled (default: true)
 * @returns 8-character hexadecimal hash, or original path if hashing disabled
 *
 * @example
 * ```ts
 * // With hashing enabled (default)
 * hashProjectName("/home/user/project/my-app") // "a3f7b2c1"
 * hashProjectName("/home/user/project/my-app") // "a3f7b2c1" (stable!)
 *
 * // With hashing disabled
 * hashProjectName("/home/user/project/my-app", false) // "/home/user/project/my-app"
 *
 * // Session IDs work too
 * hashProjectName("/home/user/project/my-app/session-abc123") // "d8e4f6a2"
 * ```
 */
export async function hashProjectName(
  projectPath: string,
  enabled: boolean = true
): Promise<string> {
  // Return original path if hashing is disabled
  if (!enabled) {
    return projectPath;
  }

  // Encode the string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(projectPath);

  // Use Web Crypto API for SHA-256 hashing
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert buffer to hex string and take first 8 characters
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex.substring(0, 8);
}

/**
 * Synchronous version of hashProjectName for contexts where async is not available.
 *
 * Note: This uses Node.js crypto module for synchronous hashing. In most cases,
 * prefer using the async version (hashProjectName) which uses Web Crypto API.
 *
 * @param projectPath - Full project path or session ID to hash
 * @param enabled - Whether hashing is enabled (default: true)
 * @returns 8-character hexadecimal hash, or original path if hashing disabled
 */
export function hashProjectNameSync(
  projectPath: string,
  enabled: boolean = true
): string {
  // Return original path if hashing is disabled
  if (!enabled) {
    return projectPath;
  }

  // Use Node.js crypto module for sync hashing
  const hash = createHash("sha256");
  hash.update(projectPath);
  const digest = hash.digest("hex");

  return digest.substring(0, 8);
}

/**
 * Batch hash multiple project paths efficiently.
 *
 * @param projectPaths - Array of project paths to hash
 * @param enabled - Whether hashing is enabled (default: true)
 * @returns Array of hashed project paths in the same order as input
 */
export async function hashProjectNames(
  projectPaths: string[],
  enabled: boolean = true
): Promise<string[]> {
  if (!enabled) {
    return projectPaths;
  }

  return Promise.all(
    projectPaths.map((path) => hashProjectName(path, enabled))
  );
}

/**
 * Batch hash multiple project paths synchronously.
 *
 * @param projectPaths - Array of project paths to hash
 * @param enabled - Whether hashing is enabled (default: true)
 * @returns Array of hashed project paths in the same order as input
 */
export function hashProjectNamesSync(
  projectPaths: string[],
  enabled: boolean = true
): string[] {
  if (!enabled) {
    return projectPaths;
  }

  return projectPaths.map((path) => hashProjectNameSync(path, enabled));
}

/**
 * Validate if a string looks like a hashed project path.
 *
 * Hashed project paths should be exactly 8 hexadecimal characters.
 *
 * @param value - Value to validate
 * @returns True if the value looks like a hashed project path
 */
export function isHashedProjectPath(value: string): boolean {
  return /^[a-f0-9]{8}$/.test(value);
}

/**
 * Convert a hash back to a placeholder identifier.
 *
 * This does NOT reverse the hash (SHA-256 is one-way), but provides
 * a consistent placeholder format for display purposes.
 *
 * @param hash - The hashed project path
 * @returns A formatted placeholder string
 */
export function formatHashedProjectPath(hash: string): string {
  if (!isHashedProjectPath(hash)) {
    return hash;
  }
  return `<project:${hash}>`;
}
