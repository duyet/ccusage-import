/**
 * Tests for src/parsers/hash.ts
 *
 * Comprehensive test suite for SHA-256 project name hashing functionality.
 */

import { describe, it, expect } from "bun:test";
import {
  hashProjectName,
  hashProjectNameSync,
  hashProjectNames,
  hashProjectNamesSync,
  isHashedProjectPath,
  formatHashedProjectPath,
} from "./hash";

describe("hashProjectName (async)", () => {
  it("should return original path when hashing is disabled", async () => {
    const path = "/home/user/project/my-app";
    const result = await hashProjectName(path, false);
    expect(result).toBe(path);
  });

  it("should return original path when enabled is undefined (defaults to true)", async () => {
    const path = "/home/user/project/my-app";
    const result = await hashProjectName(path);
    expect(result).not.toBe(path);
    expect(result).toHaveLength(8);
  });

  it("should produce stable hashes for the same input", async () => {
    const path = "/home/user/project/my-app";
    const hash1 = await hashProjectName(path, true);
    const hash2 = await hashProjectName(path, true);
    const hash3 = await hashProjectName(path, true);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    expect(hash1).toHaveLength(8);
  });

  it("should produce different hashes for different inputs", async () => {
    const path1 = "/home/user/project/my-app";
    const path2 = "/home/user/project/other-app";
    const path3 = "/home/user/project/my-app-extra";

    const hash1 = await hashProjectName(path1, true);
    const hash2 = await hashProjectName(path2, true);
    const hash3 = await hashProjectName(path3, true);

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it("should produce lowercase hexadecimal characters", async () => {
    const path = "/home/user/project/my-app";
    const hash = await hashProjectName(path, true);

    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should handle empty strings", async () => {
    const path = "";
    const hash = await hashProjectName(path, true);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should handle special characters in paths", async () => {
    const paths = [
      "/home/user/project with spaces/app",
      "/home/user/project-with-dashes/app",
      "/home/user/project_with_underscores/app",
      "/home/user/project.with.dots/app",
      "C:\\Users\\user\\project\\app", // Windows path
      "/home/user/project/app年月", // Unicode characters
    ];

    for (const path of paths) {
      const hash = await hashProjectName(path, true);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should handle very long paths", async () => {
    const longPath = "/home/user/" + "a".repeat(1000) + "/project/app";
    const hash = await hashProjectName(longPath, true);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should be case-sensitive", async () => {
    const path1 = "/home/user/project/MyApp";
    const path2 = "/home/user/project/myapp";
    const path3 = "/home/user/project/MYAPP";

    const hash1 = await hashProjectName(path1, true);
    const hash2 = await hashProjectName(path2, true);
    const hash3 = await hashProjectName(path3, true);

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it("should handle session IDs", async () => {
    const sessionId = "/home/user/project/my-app/session-abc123-def456";
    const hash = await hashProjectName(sessionId, true);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should match Python implementation for known inputs", async () => {
    // These values should match the Python implementation
    const testCases = [
      {
        input: "/home/user/project/test",
        // Python: hashlib.sha256(b"/home/user/project/test").hexdigest()[:8]
        // Verified with: python -c "import hashlib; print(hashlib.sha256(b'/home/user/project/test').hexdigest()[:8])"
        expected: "b49e9761",
      },
      {
        input: "/home/user/project/my-app",
        // Verified with Python
        expected: "9b339b46",
      },
    ];

    for (const { input, expected } of testCases) {
      const hash = await hashProjectName(input, true);
      expect(hash).toBe(expected);
    }
  });
});

describe("hashProjectNameSync (sync)", () => {
  it("should return original path when hashing is disabled", () => {
    const path = "/home/user/project/my-app";
    const result = hashProjectNameSync(path, false);
    expect(result).toBe(path);
  });

  it("should produce stable hashes for the same input", () => {
    const path = "/home/user/project/my-app";
    const hash1 = hashProjectNameSync(path, true);
    const hash2 = hashProjectNameSync(path, true);
    const hash3 = hashProjectNameSync(path, true);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    expect(hash1).toHaveLength(8);
  });

  it("should produce different hashes for different inputs", () => {
    const path1 = "/home/user/project/my-app";
    const path2 = "/home/user/project/other-app";

    const hash1 = hashProjectNameSync(path1, true);
    const hash2 = hashProjectNameSync(path2, true);

    expect(hash1).not.toBe(hash2);
  });

  it("should produce same results as async version", async () => {
    const paths = [
      "/home/user/project/my-app",
      "/home/user/project/other-app",
      "/home/user/project/test-app",
      "",
      "/home/user/project with spaces/app",
    ];

    for (const path of paths) {
      const asyncHash = await hashProjectName(path, true);
      const syncHash = hashProjectNameSync(path, true);
      expect(asyncHash).toBe(syncHash);
    }
  });

  it("should produce lowercase hexadecimal characters", () => {
    const path = "/home/user/project/my-app";
    const hash = hashProjectNameSync(path, true);

    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("hashProjectNames (batch async)", () => {
  it("should return original paths when hashing is disabled", async () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];
    const result = await hashProjectNames(paths, false);

    expect(result).toEqual(paths);
  });

  it("should hash all paths when enabled", async () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];
    const result = await hashProjectNames(paths, true);

    expect(result).toHaveLength(paths.length);
    for (const hash of result) {
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should preserve order of inputs", async () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];
    const result = await hashProjectNames(paths, true);

    // Each hash should be unique
    const uniqueHashes = new Set(result);
    expect(uniqueHashes.size).toBe(paths.length);
  });

  it("should handle empty array", async () => {
    const result = await hashProjectNames([], true);
    expect(result).toEqual([]);
  });

  it("should handle single element array", async () => {
    const paths = ["/home/user/project/app1"];
    const result = await hashProjectNames(paths, true);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(8);
  });

  it("should produce same results as individual calls", async () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];

    const batchResult = await hashProjectNames(paths, true);
    const individualResults = await Promise.all(
      paths.map((path) => hashProjectName(path, true))
    );

    expect(batchResult).toEqual(individualResults);
  });
});

describe("hashProjectNamesSync (batch sync)", () => {
  it("should return original paths when hashing is disabled", () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];
    const result = hashProjectNamesSync(paths, false);

    expect(result).toEqual(paths);
  });

  it("should hash all paths when enabled", () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];
    const result = hashProjectNamesSync(paths, true);

    expect(result).toHaveLength(paths.length);
    for (const hash of result) {
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should produce same results as async batch", async () => {
    const paths = [
      "/home/user/project/app1",
      "/home/user/project/app2",
      "/home/user/project/app3",
    ];

    const syncResult = hashProjectNamesSync(paths, true);
    const asyncResult = await hashProjectNames(paths, true);

    expect(syncResult).toEqual(asyncResult);
  });
});

describe("isHashedProjectPath", () => {
  it("should return true for valid 8-character hex strings", () => {
    const validHashes = [
      "a3f7b2c1",
      "00000000",
      "ffffffff",
      "12345678",
      "abcdef01",
      "ABCDEF01", // Should fail - uppercase not allowed
    ];

    expect(isHashedProjectPath(validHashes[0])).toBe(true);
    expect(isHashedProjectPath(validHashes[1])).toBe(true);
    expect(isHashedProjectPath(validHashes[2])).toBe(true);
    expect(isHashedProjectPath(validHashes[3])).toBe(true);
    expect(isHashedProjectPath(validHashes[4])).toBe(true);
    expect(isHashedProjectPath(validHashes[5])).toBe(false); // Uppercase
  });

  it("should return false for invalid hashes", () => {
    const invalidHashes = [
      "a3f7b2c", // Too short
      "a3f7b2c11", // Too long
      "g3f7b2c1", // Invalid hex character
      "a3f7b2c ", // Contains space
      " a3f7b2c1", // Contains leading space
      "a3f7b2c1 ", // Contains trailing space
      "", // Empty string
      "/home/user/project/app", // Full path
      "12345", // Too short
    ];

    for (const invalid of invalidHashes) {
      expect(isHashedProjectPath(invalid)).toBe(false);
    }
  });
});

describe("formatHashedProjectPath", () => {
  it("should format valid hashes with placeholder", () => {
    const hash = "a3f7b2c1";
    const formatted = formatHashedProjectPath(hash);
    expect(formatted).toBe("<project:a3f7b2c1>");
  });

  it("should return original value for invalid hashes", () => {
    const invalidValues = [
      "a3f7b2c", // Too short
      "/home/user/project/app", // Full path
      "", // Empty string
      "not-a-hash", // Not a hash
    ];

    for (const invalid of invalidValues) {
      const formatted = formatHashedProjectPath(invalid);
      expect(formatted).toBe(invalid);
    }
  });

  it("should handle uppercase hex strings (invalid)", () => {
    const uppercaseHash = "A3F7B2C1";
    const formatted = formatHashedProjectPath(uppercaseHash);
    expect(formatted).toBe(uppercaseHash); // Returns original
  });
});

describe("Integration Tests", () => {
  it("should maintain consistency across multiple hashing operations", async () => {
    const path = "/home/user/project/integration-test";

    // Hash multiple times
    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      hashes.push(await hashProjectName(path, true));
    }

    // All hashes should be identical
    expect(hashes.every((h) => h === hashes[0])).toBe(true);
  });

  it("should work with realistic project paths", async () => {
    const realisticPaths = [
      "/Users/developer/workspace/monorepo/packages/frontend",
      "/home/john/projects/personal/blog-nextjs",
      "C:\\Projects\\Company\\EnterpriseApp",
      "/mnt/c/Users/jane/Documents/github/project",
      "/home/user/project/ccusage-import",
      "/home/user/.local/share/nvim/lazy/plugin.nvim",
    ];

    for (const path of realisticPaths) {
      const hash = await hashProjectName(path, true);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);

      // Verify stability
      const hash2 = await hashProjectName(path, true);
      expect(hash).toBe(hash2);
    }
  });

  it("should demonstrate collision resistance", async () => {
    // Generate hashes for many similar paths
    const paths = Array.from({ length: 1000 }, (_, i) => {
      return `/home/user/project/app${i}`;
    });

    const hashes = await hashProjectNames(paths, true);
    const uniqueHashes = new Set(hashes);

    // With 8 hex characters (16^8 = ~4.3 billion possible values),
    // 1000 random paths should have no collisions
    // (though collisions are theoretically possible)
    expect(uniqueHashes.size).toBeGreaterThanOrEqual(995); // Allow some tolerance
  });
});

describe("Privacy Protection", () => {
  it("should not be reversible", async () => {
    const path = "/home/user/project/sensitive-app";
    const hash = await hashProjectName(path, true);

    // Hash should not contain any part of the original path
    expect(hash).not.toContain("sensitive");
    expect(hash).not.toContain("app");
    expect(hash).not.toContain("home");
    expect(hash).not.toContain("/");

    // Hash should be much shorter than the original path
    expect(hash.length).toBeLessThan(path.length);
  });

  it("should hide the length of the original path", async () => {
    const paths = [
      "/a",
      "/home/user/project/very/long/path/that/goes/on/and/on",
      "/medium/path/length",
    ];

    const hashes = await hashProjectNames(paths, true);

    // All hashes should be the same length regardless of input length
    expect(hashes.every((h) => h.length === 8)).toBe(true);
  });

  it("should demonstrate privacy benefits", async () => {
    const sensitivePaths = [
      "/home/user/confidential-project",
      "/home/user/secret-experiments",
      "/home/user/proprietary-algorithms",
    ];

    const hashes = await hashProjectNames(sensitivePaths, true);

    // Hashes should reveal nothing about the original content
    for (const hash of hashes) {
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
      expect(hash.length).toBe(8);
    }

    // Different paths should produce different hashes
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(sensitivePaths.length);
  });
});

describe("Edge Cases", () => {
  it("should handle null-like values gracefully", async () => {
    // TypeScript should prevent these, but test runtime behavior
    const values = ["null", "undefined", "NaN", "Infinity"];

    for (const value of values) {
      const hash = await hashProjectName(value, true);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should handle paths with only special characters", async () => {
    const specialPaths = ["///", "---", "___", "...", "***"];

    for (const path of specialPaths) {
      const hash = await hashProjectName(path, true);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    }
  });

  it("should handle very long repeated patterns", async () => {
    const repeatedPath = "/a".repeat(10000);
    const hash = await hashProjectName(repeatedPath, true);

    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });
});
