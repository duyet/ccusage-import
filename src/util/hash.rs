/**
 * SHA-256 project-name hashing for privacy protection.
 *
 * Uses the `sha2` crate to produce an 8-character lowercase hex hash
 * identical to the TS implementation:
 * `crypto.createHash('sha256').update(path).digest('hex').slice(0, 8)`
 */

use sha2::{Digest, Sha256};

/// Return the first 8 lowercase hex chars of `SHA-256(input)`.
pub fn hash_project_name_sync(project_path: &str, enabled: bool) -> String {
    if !enabled {
        return project_path.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    let result = hasher.finalize();
    // Take first 4 bytes → 8 hex chars
    format!("{:02x}{:02x}{:02x}{:02x}", result[0], result[1], result[2], result[3])
}

/// Batch hash multiple paths synchronously.
pub fn hash_project_names_sync(paths: &[&str], enabled: bool) -> Vec<String> {
    if !enabled {
        return paths.iter().map(|p| p.to_string()).collect();
    }
    paths.iter().map(|p| hash_project_name_sync(p, true)).collect()
}

/// Dedup key: first 16 hex chars of SHA-256 of the joined raw key.
pub fn make_dedup_key(raw_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let result = hasher.finalize();
    // Take first 8 bytes → 16 hex chars
    format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        result[0], result[1], result[2], result[3], result[4], result[5], result[6], result[7]
    )
}

/// Check if a string looks like a hashed project path (8 lowercase hex chars).
pub fn is_hashed_project_path(value: &str) -> bool {
    value.len() == 8
        && value.chars().all(|c| c.is_ascii_hexdigit())
        && value.chars().filter(|c| c.is_ascii_alphabetic()).all(|c| c.is_ascii_lowercase())
}

/// Format a hash as a placeholder, or return original if not a valid hash.
pub fn format_hashed_project_path(hash: &str) -> String {
    if is_hashed_project_path(hash) {
        format!("<project:{}>", hash)
    } else {
        hash.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ts_hash_for_known_inputs() {
        // Verified with TS: createHash('sha256').update('/home/user/project/test').digest('hex').slice(0,8)
        assert_eq!(hash_project_name_sync("/home/user/project/test", true), "b49e9761");
        assert_eq!(hash_project_name_sync("/home/user/project/my-app", true), "9b339b46");
    }

    #[test]
    fn disabled_returns_original() {
        assert_eq!(hash_project_name_sync("/home/user/project/my-app", false), "/home/user/project/my-app");
    }

    #[test]
    fn stable_across_calls() {
        let h1 = hash_project_name_sync("/home/user/project/my-app", true);
        let h2 = hash_project_name_sync("/home/user/project/my-app", true);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 8);
    }

    #[test]
    fn different_inputs_different_hashes() {
        assert_ne!(
            hash_project_name_sync("/a", true),
            hash_project_name_sync("/b", true),
        );
    }

    #[test]
    fn lowercase_hex_only() {
        let h = hash_project_name_sync("/some/path", true);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(h.chars().filter(|c| c.is_ascii_alphabetic()).all(|c| c.is_ascii_lowercase()));
    }

    #[test]
    fn empty_string_works() {
        let h = hash_project_name_sync("", true);
        assert_eq!(h.len(), 8);
    }

    #[test]
    fn batch_matches_individual() {
        let paths = ["/a", "/b", "/c"];
        let batch = hash_project_names_sync(&paths, true);
        let individual: Vec<String> = paths.iter().map(|p| hash_project_name_sync(p, true)).collect();
        assert_eq!(batch, individual);
    }

    #[test]
    fn is_hashed_project_path_valid() {
        assert!(is_hashed_project_path("a3f7b2c1"));
        assert!(is_hashed_project_path("00000000"));
        assert!(is_hashed_project_path("abcdef01"));
        assert!(!is_hashed_project_path("A3F7B2C1")); // uppercase
        assert!(!is_hashed_project_path("a3f7b2c"));   // too short
        assert!(!is_hashed_project_path("a3f7b2c11")); // too long
    }

    #[test]
    fn format_hashed_project_path_works() {
        assert_eq!(format_hashed_project_path("a3f7b2c1"), "<project:a3f7b2c1>");
        assert_eq!(format_hashed_project_path("/home/user"), "/home/user");
    }

    #[test]
    fn dedup_key_16_chars() {
        let key = hash_project_name_sync("/home/user/project/my-app", true);
        let dk = make_dedup_key(&format!("ccusage|{}|daily|2025-01-05|{}|2025-01-05", "test-machine", key));
        assert_eq!(dk.len(), 16);
    }
}
