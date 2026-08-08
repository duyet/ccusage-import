use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub type EnvLookup = dyn Fn(&str) -> Option<String> + Send + Sync;

/// Product / XDG config directory name (`~/.config/sumptus/`).
pub const CONFIG_DIR_NAME: &str = "sumptus";
/// Main config file basename.
pub const CONFIG_FILE_NAME: &str = "config.toml";
/// Credentials file basename (passwords/tokens only).
pub const CREDENTIALS_FILE_NAME: &str = "credentials.toml";
/// Env override for main config path.
pub const CONFIG_ENV: &str = "SUMPTUS_CONFIG";
/// Env override for credentials path.
pub const CREDENTIALS_ENV: &str = "SUMPTUS_CREDENTIALS";
/// Legacy env override (still honored).
pub const LEGACY_CONFIG_ENV: &str = "CCUSAGE_IMPORT_CONFIG";

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ClickHouseConfig {
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub protocol: String,
}

impl ClickHouseConfig {
    pub fn from_env() -> Self {
        let port_str = std::env::var("CH_PORT").unwrap_or_else(|_| "8123".to_string());
        let port = port_str.parse().unwrap_or(8123);
        Self {
            host: std::env::var("CH_HOST").unwrap_or_else(|_| "localhost".to_string()),
            port,
            user: std::env::var("CH_USER").unwrap_or_else(|_| "default".to_string()),
            password: std::env::var("CH_PASSWORD").unwrap_or_default(),
            database: std::env::var("CH_DATABASE").unwrap_or_else(|_| "default".to_string()),
            protocol: std::env::var("CH_PROTOCOL").unwrap_or_else(|_| {
                if port == 443 || port == 8443 || port == 9440 {
                    "https".to_string()
                } else {
                    "http".to_string()
                }
            }),
        }
    }
}

/// Secrets-only overlay. Never required in main `config.toml`.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Credentials {
    #[serde(default)]
    pub clickhouse_password: Option<String>,
    #[serde(default)]
    pub motherduck_token: Option<String>,
    /// Alias accepted for MotherDuck token.
    #[serde(default)]
    pub motherduck: Option<String>,
    #[serde(default)]
    pub ch_password: Option<String>,
}

impl Credentials {
    /// Load credentials from an explicit path or discovery order.
    pub fn load(path: Option<&str>) -> anyhow::Result<Self> {
        let raw = match path {
            Some(p) => {
                if Path::new(p).exists() {
                    std::fs::read_to_string(p)?
                } else {
                    String::new()
                }
            }
            None => Self::find_and_read()?,
        };
        if raw.trim().is_empty() {
            return Ok(Self::default());
        }
        let interpolated = Config::interpolate_env(&raw);
        Ok(toml::from_str(&interpolated)?)
    }

    fn find_and_read() -> anyhow::Result<String> {
        for path in Self::candidate_paths() {
            if Path::new(&path).exists() {
                return Ok(std::fs::read_to_string(&path)?);
            }
        }
        Ok(String::new())
    }

    /// Credential file discovery (first existing wins).
    /// Order: `$SUMPTUS_CREDENTIALS` → `./credentials.toml` → `./sumptus.credentials.toml`
    /// → `~/.config/sumptus/credentials.toml` → `~/.sumptus/credentials.toml`
    pub fn candidate_paths() -> Vec<String> {
        let mut candidates = Vec::new();
        if let Ok(env_path) = std::env::var(CREDENTIALS_ENV) {
            candidates.push(env_path);
        }
        candidates.push("./credentials.toml".to_string());
        candidates.push("./sumptus.credentials.toml".to_string());
        if let Some(config_home) = dirs::config_dir() {
            candidates.push(
                config_home
                    .join(CONFIG_DIR_NAME)
                    .join(CREDENTIALS_FILE_NAME)
                    .display()
                    .to_string(),
            );
        }
        if let Some(home) = dirs::home_dir() {
            candidates.push(
                home.join(".sumptus")
                    .join(CREDENTIALS_FILE_NAME)
                    .display()
                    .to_string(),
            );
        }
        candidates
    }

    pub fn clickhouse_password(&self) -> Option<&str> {
        self.clickhouse_password
            .as_deref()
            .or(self.ch_password.as_deref())
            .filter(|s| !s.is_empty())
    }

    pub fn motherduck_token(&self) -> Option<&str> {
        self.motherduck_token
            .as_deref()
            .or(self.motherduck.as_deref())
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ImporterConfig {
    pub hash_project_names: Option<bool>,
    pub machine_name: Option<String>,
    pub command_timeout: Option<u64>,
    pub max_parallel_workers: Option<u32>,
    pub duckdb_path: Option<String>,
    pub days_back: Option<i64>,
    pub since: Option<String>,
    pub end_date: Option<String>,
    pub skip_ccusage: Option<bool>,
    pub skip_opencode: Option<bool>,
    pub skip_codex: Option<bool>,
    pub skip_antigravity: Option<bool>,
    pub skip_hermes: Option<bool>,
    pub skip_clickhouse: Option<bool>,
    pub opencode_path: Option<String>,
    pub codex_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct UiConfig {
    pub animated: Option<bool>,
    pub color: Option<bool>,
    pub verbose: Option<bool>,
    pub quiet: Option<bool>,
    pub heatmap_min_intensity: Option<u8>,
    pub heatmap_max_intensity: Option<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Config {
    #[serde(default)]
    pub clickhouse: ClickHouseConfig,
    #[serde(default)]
    pub importer: ImporterConfig,
    #[serde(default)]
    pub ui: UiConfig,
}

impl Config {
    pub fn load(path: Option<&str>) -> anyhow::Result<Self> {
        let raw = match path {
            Some(p) => std::fs::read_to_string(p)?,
            None => Self::find_and_read()?,
        };
        let interpolated = Self::interpolate_env(&raw);
        let mut cfg: Config = if raw.trim().is_empty() {
            Config::default()
        } else {
            toml::from_str(&interpolated)?
        };
        cfg.apply_credentials(&Credentials::load(None)?)?;
        cfg.apply_env_fallback();
        Ok(cfg)
    }

    /// Load config + credentials with explicit credential path (for tests).
    /// When `config_path` is `Some`, the file must exist (CLI `--config`).
    /// When `None`, discovery is used and missing files yield defaults.
    pub fn load_with_credentials(
        config_path: Option<&str>,
        credentials_path: Option<&str>,
    ) -> anyhow::Result<Self> {
        let raw = match config_path {
            Some(p) => std::fs::read_to_string(p).map_err(|e| {
                anyhow::anyhow!("config file not found or unreadable at `{p}`: {e}")
            })?,
            None => Self::find_and_read()?,
        };
        let interpolated = Self::interpolate_env(&raw);
        let mut cfg: Config = if raw.trim().is_empty() {
            Config::default()
        } else {
            toml::from_str(&interpolated)?
        };
        let creds = Credentials::load(credentials_path)?;
        cfg.apply_credentials(&creds)?;
        cfg.apply_env_fallback();
        Ok(cfg)
    }

    /// Merge secrets from a credentials file. Password/token in main config
    /// win if already set; credentials fill empty fields only.
    pub fn apply_credentials(&mut self, creds: &Credentials) -> anyhow::Result<()> {
        if self.clickhouse.password.is_empty() {
            if let Some(pw) = creds.clickhouse_password() {
                self.clickhouse.password = pw.to_string();
            }
        }
        // MotherDuck token is env-driven at runtime; export if not already set.
        if std::env::var("MOTHERDUCK_TOKEN").ok().filter(|s| !s.is_empty()).is_none() {
            if let Some(token) = creds.motherduck_token() {
                std::env::set_var("MOTHERDUCK_TOKEN", token);
            }
        }
        Ok(())
    }

    fn find_and_read() -> anyhow::Result<String> {
        for path in Self::candidate_paths() {
            if Path::new(&path).exists() {
                return Ok(std::fs::read_to_string(&path)?);
            }
        }
        Ok(String::new())
    }

    /// Config discovery order (first existing wins).
    ///
    /// 1. `$SUMPTUS_CONFIG` / `$CCUSAGE_IMPORT_CONFIG`
    /// 2. `./sumptus.toml` / `./ccusage-import.toml`
    /// 3. `~/.config/sumptus/config.toml` (XDG)
    /// 4. `~/.sumptus/config.toml`
    /// 5. `~/.ccusage-import.toml` (legacy)
    /// 6. `/etc/sumptus/config.toml`
    pub fn candidate_paths() -> Vec<String> {
        Self::candidate_paths_with(|k| std::env::var(k).ok(), dirs::config_dir(), dirs::home_dir())
    }

    /// Pure path resolution for tests (inject env + home dirs).
    pub fn candidate_paths_with<F>(
        env_lookup: F,
        config_dir: Option<PathBuf>,
        home_dir: Option<PathBuf>,
    ) -> Vec<String>
    where
        F: Fn(&str) -> Option<String>,
    {
        let mut candidates = Vec::new();

        if let Some(p) = env_lookup(CONFIG_ENV) {
            candidates.push(p);
        }
        if let Some(p) = env_lookup(LEGACY_CONFIG_ENV) {
            candidates.push(p);
        }

        candidates.push("./sumptus.toml".to_string());
        candidates.push("./ccusage-import.toml".to_string());

        if let Some(config_home) = config_dir {
            candidates.push(
                config_home
                    .join(CONFIG_DIR_NAME)
                    .join(CONFIG_FILE_NAME)
                    .display()
                    .to_string(),
            );
        }

        if let Some(home) = home_dir {
            candidates.push(
                home.join(".sumptus")
                    .join(CONFIG_FILE_NAME)
                    .display()
                    .to_string(),
            );
            candidates.push(format!("{}/.ccusage-import.toml", home.display()));
        }

        candidates.push(format!("/etc/{CONFIG_DIR_NAME}/{CONFIG_FILE_NAME}"));
        candidates
    }

    /// Default local DuckDB path: `~/.local/share/sumptus/sumptus.duckdb`
    /// (or platform data dir). Auto-created by the DuckDB sink on open.
    pub fn default_duckdb_path() -> String {
        Self::default_duckdb_path_with(dirs::data_local_dir(), dirs::home_dir())
    }

    pub fn default_duckdb_path_with(
        data_local: Option<PathBuf>,
        home: Option<PathBuf>,
    ) -> String {
        if let Some(base) = data_local {
            return base
                .join(CONFIG_DIR_NAME)
                .join("sumptus.duckdb")
                .display()
                .to_string();
        }
        if let Some(home) = home {
            return home
                .join(".local")
                .join("share")
                .join(CONFIG_DIR_NAME)
                .join("sumptus.duckdb")
                .display()
                .to_string();
        }
        format!("./{CONFIG_DIR_NAME}.duckdb")
    }

    /// Resolve DuckDB path: CLI/env/config override, else local default.
    /// MotherDuck (`md:…`) is only used when explicitly configured.
    pub fn resolve_duckdb_path(explicit: Option<&str>) -> String {
        if let Some(p) = explicit {
            if !p.is_empty() {
                return p.to_string();
            }
        }
        if let Ok(p) = std::env::var("DUCKDB_PATH") {
            if !p.is_empty() {
                return p;
            }
        }
        Self::default_duckdb_path()
    }

    pub fn interpolate_env(input: &str) -> String {
        let re = regex::Regex::new(r"\$\{([^}]+)\}").expect("valid env interpolation regex");
        re.replace_all(input, |caps: &regex::Captures<'_>| {
            std::env::var(&caps[1]).unwrap_or_else(|_| caps[0].to_string())
        })
        .to_string()
    }

    pub fn apply_env_fallback(&mut self) {
        self.apply_env_fallback_with(|k| std::env::var(k).ok());
    }

    pub fn apply_env_fallback_with<F>(&mut self, env_lookup: F)
    where
        F: Fn(&str) -> Option<String>,
    {
        if self.clickhouse.host.is_empty() {
            self.clickhouse.host = env_lookup("CH_HOST").unwrap_or_default();
        }
        if self.clickhouse.port == 0 {
            self.clickhouse.port = env_lookup("CH_PORT")
                .and_then(|v| v.parse().ok())
                .unwrap_or(8123);
        }
        if self.clickhouse.user.is_empty() {
            self.clickhouse.user = env_lookup("CH_USER").unwrap_or_default();
        }
        if self.clickhouse.password.is_empty() {
            self.clickhouse.password = env_lookup("CH_PASSWORD").unwrap_or_default();
        }
        if self.clickhouse.database.is_empty() {
            self.clickhouse.database = env_lookup("CH_DATABASE").unwrap_or_default();
        }
        if self.clickhouse.protocol.is_empty() {
            self.clickhouse.protocol = env_lookup("CH_PROTOCOL").unwrap_or_else(|| "http".into());
        }
        if self.importer.duckdb_path.is_none() {
            self.importer.duckdb_path = env_lookup("DUCKDB_PATH");
        }
        if self.importer.machine_name.is_none() {
            self.importer.machine_name = env_lookup("IMPORT_MACHINE_NAME");
        }
        if self.importer.command_timeout.is_none() {
            self.importer.command_timeout = env_lookup("IMPORT_COMMAND_TIMEOUT_MS")
                .and_then(|v| v.parse().ok());
        }
        if self.importer.max_parallel_workers.is_none() {
            self.importer.max_parallel_workers = env_lookup("IMPORT_MAX_PARALLEL_WORKERS")
                .and_then(|v| v.parse().ok());
        }
        if self.importer.hash_project_names.is_none() {
            self.importer.hash_project_names = env_lookup("IMPORT_HASH_PROJECT_NAMES")
                .and_then(|v| v.parse().ok());
        }
        if self.importer.days_back.is_none() {
            self.importer.days_back = env_lookup("IMPORT_DAYS_BACK")
                .and_then(|v| v.parse().ok());
        }
        if self.importer.opencode_path.is_none() {
            self.importer.opencode_path = env_lookup("OPENCODE_DATA_DIR");
        }
        if self.importer.codex_path.is_none() {
            self.importer.codex_path = env_lookup("CODEX_HOME");
        }
    }

    pub fn to_env_map(&self) -> HashMap<String, String> {
        let mut map = HashMap::new();

        map.insert("CH_HOST".into(), self.clickhouse.host.clone());
        map.insert("CH_PORT".into(), self.clickhouse.port.to_string());
        map.insert("CH_USER".into(), self.clickhouse.user.clone());
        map.insert("CH_PASSWORD".into(), self.clickhouse.password.clone());
        map.insert("CH_DATABASE".into(), self.clickhouse.database.clone());
        map.insert("CH_PROTOCOL".into(), self.clickhouse.protocol.clone());

        if let Some(path) = &self.importer.duckdb_path {
            map.insert("DUCKDB_PATH".into(), path.clone());
        }
        if let Some(name) = &self.importer.machine_name {
            map.insert("IMPORT_MACHINE_NAME".into(), name.clone());
        }
        if let Some(timeout) = self.importer.command_timeout {
            map.insert("IMPORT_COMMAND_TIMEOUT_MS".into(), timeout.to_string());
        }
        if let Some(workers) = self.importer.max_parallel_workers {
            map.insert("IMPORT_MAX_PARALLEL_WORKERS".into(), workers.to_string());
        }
        if let Some(hash) = self.importer.hash_project_names {
            map.insert("IMPORT_HASH_PROJECT_NAMES".into(), hash.to_string());
        }
        if let Some(days) = self.importer.days_back {
            map.insert("IMPORT_DAYS_BACK".into(), days.to_string());
        }
        if let Some(path) = &self.importer.opencode_path {
            map.insert("OPENCODE_DATA_DIR".into(), path.clone());
        }
        if let Some(path) = &self.importer.codex_path {
            map.insert("CODEX_HOME".into(), path.clone());
        }

        map
    }

    pub fn write_toml<P: AsRef<Path>>(&self, path: P) -> anyhow::Result<PathBuf> {
        let content = toml::to_string_pretty(self)?;
        if let Some(parent) = path.as_ref().parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(&path, content)?;
        Ok(path.as_ref().to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::io::Write;

    struct EnvGuard {
        keys: &'static [&'static str],
        prev: Vec<Option<String>>,
    }

    impl EnvGuard {
        fn new(keys: &'static [&'static str]) -> Self {
            let prev = keys.iter().map(|k| env::var(k).ok()).collect();
            for key in keys {
                let _ = env::remove_var(key);
            }
            Self { keys, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, prev_val) in self.keys.iter().zip(self.prev.drain(..)) {
                match prev_val {
                    Some(v) => {
                        let _ = env::set_var(key, v);
                    }
                    None => {
                        let _ = env::remove_var(key);
                    }
                }
            }
        }
    }

    #[test]
    fn empty_toml_returns_defaults() {
        let cfg: Config = toml::from_str("").unwrap();
        assert!(cfg.clickhouse.host.is_empty());
        assert_eq!(cfg.clickhouse.port, 0);
    }

    #[test]
    fn parses_full_toml() {
        let toml_str = r#"
            [clickhouse]
            host = "localhost"
            port = 8123
            user = "default"
            password = ""
            database = "analytics"
            protocol = "https"

            [importer]
            machine_name = "devbox"
            hash_project_names = true
            days_back = 7
        "#;
        let cfg: Config = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.clickhouse.host, "localhost");
        assert_eq!(cfg.clickhouse.port, 8123);
        assert_eq!(cfg.clickhouse.user, "default");
        assert_eq!(cfg.clickhouse.database, "analytics");
        assert_eq!(cfg.clickhouse.protocol, "https");
        assert_eq!(cfg.importer.machine_name.as_deref(), Some("devbox"));
        assert_eq!(cfg.importer.hash_project_names, Some(true));
        assert_eq!(cfg.importer.days_back, Some(7));
    }

    #[test]
    fn env_interpolation_replaces_placeholders() {
        let _guard = EnvGuard::new(&["MY_CH_HOST", "MY_CH_DB"]);
        env::set_var("MY_CH_HOST", "db.example.com");
        env::set_var("MY_CH_DB", "prod");
        let toml_str = r#"
            [clickhouse]
            host = "${MY_CH_HOST}"
            port = 8123
            user = "default"
            password = ""
            database = "${MY_CH_DB}"
            protocol = "http"
        "#;
        let cfg: Config = toml::from_str(&Config::interpolate_env(toml_str)).unwrap();
        assert_eq!(cfg.clickhouse.host, "db.example.com");
        assert_eq!(cfg.clickhouse.database, "prod");
    }

    #[test]
    fn env_interpolation_keeps_placeholder_on_missing() {
        let _guard = EnvGuard::new(&["MISSING_VAR"]);
        let toml_str = r#"
            [clickhouse]
            host = "${MISSING_VAR}"
            port = 8123
            user = "default"
            password = ""
            database = "analytics"
            protocol = "http"
        "#;
        let cfg: Config = toml::from_str(&Config::interpolate_env(toml_str)).unwrap();
        assert_eq!(cfg.clickhouse.host, "${MISSING_VAR}");
    }

    #[test]
    fn apply_env_fallback_when_fields_empty() {
        const KEYS: &[&str] = &[
            "CH_HOST",
            "CH_PORT",
            "CH_DATABASE",
            "DUCKDB_PATH",
            "IMPORT_MACHINE_NAME",
        ];
        let _guard = EnvGuard::new(KEYS);

        let mut env_map: HashMap<String, String> = HashMap::new();
        env_map.insert("CH_HOST".into(), "env-host".into());
        env_map.insert("CH_PORT".into(), "8443".into());
        env_map.insert("CH_DATABASE".into(), "env_db".into());
        env_map.insert("DUCKDB_PATH".into(), "/tmp/duck.duckdb".into());
        env_map.insert("IMPORT_MACHINE_NAME".into(), "env-machine".into());

        let toml_str = r#"
            [clickhouse]
            host = ""
            port = 0
            user = ""
            password = ""
            database = ""
            protocol = ""

            [importer]
        "#;
        let mut cfg: Config = toml::from_str(toml_str).unwrap();
        cfg.apply_env_fallback_with(|key| env_map.get(key).cloned());
        assert_eq!(cfg.clickhouse.host, "env-host");
        assert_eq!(cfg.clickhouse.port, 8443);
        assert_eq!(cfg.clickhouse.user, "");
        assert_eq!(cfg.clickhouse.password, "");
        assert_eq!(cfg.clickhouse.database, "env_db");
        assert_eq!(cfg.clickhouse.protocol, "http");
        assert_eq!(
            cfg.importer.duckdb_path.as_deref(),
            Some("/tmp/duck.duckdb")
        );
        assert_eq!(cfg.importer.machine_name.as_deref(), Some("env-machine"));
    }

    #[test]
    fn candidate_paths_include_local_and_xdg() {
        let config_dir = PathBuf::from("/home/user/.config");
        let home = PathBuf::from("/home/user");
        let paths = Config::candidate_paths_with(|_| None, Some(config_dir), Some(home));
        assert!(paths.iter().any(|p| p.ends_with("./sumptus.toml")));
        assert!(paths
            .iter()
            .any(|p| p.contains("/.config/sumptus/config.toml")));
        assert!(paths.iter().any(|p| p.contains("/.sumptus/config.toml")));
        assert!(paths.iter().any(|p| p.ends_with(".ccusage-import.toml")));
        assert!(paths.iter().any(|p| p == "/etc/sumptus/config.toml"));
        // Local project files before XDG
        let local_idx = paths.iter().position(|p| p == "./sumptus.toml").unwrap();
        let xdg_idx = paths
            .iter()
            .position(|p| p.contains("/.config/sumptus/config.toml"))
            .unwrap();
        assert!(local_idx < xdg_idx);
    }

    #[test]
    fn candidate_paths_env_override_first() {
        let paths = Config::candidate_paths_with(
            |k| {
                if k == CONFIG_ENV {
                    Some("/custom/sumptus.toml".into())
                } else {
                    None
                }
            },
            None,
            None,
        );
        assert_eq!(paths[0], "/custom/sumptus.toml");
    }

    #[test]
    fn credentials_fill_password_separately_from_main_config() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        let creds_path = dir.path().join("credentials.toml");

        let mut f = std::fs::File::create(&config_path).unwrap();
        writeln!(
            f,
            r#"[clickhouse]
host = "ch.example.com"
port = 8443
user = "analytics"
password = ""
database = "usage"
protocol = "https"
"#
        )
        .unwrap();

        let mut f = std::fs::File::create(&creds_path).unwrap();
        writeln!(
            f,
            r#"clickhouse_password = "s3cret-from-creds"
motherduck_token = "md-token-xyz"
"#
        )
        .unwrap();

        // Main TOML must not require password
        let main: Config = toml::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert!(main.clickhouse.password.is_empty());

        let cfg = Config::load_with_credentials(
            Some(config_path.to_str().unwrap()),
            Some(creds_path.to_str().unwrap()),
        )
        .unwrap();
        assert_eq!(cfg.clickhouse.host, "ch.example.com");
        assert_eq!(cfg.clickhouse.password, "s3cret-from-creds");
        assert_eq!(
            std::env::var("MOTHERDUCK_TOKEN").ok().as_deref(),
            Some("md-token-xyz")
        );
        let _ = env::remove_var("MOTHERDUCK_TOKEN");
    }

    #[test]
    fn default_duckdb_path_uses_data_local() {
        let path = Config::default_duckdb_path_with(
            Some(PathBuf::from("/Users/me/Library/Application Support")),
            Some(PathBuf::from("/Users/me")),
        );
        assert!(path.ends_with("sumptus/sumptus.duckdb"));
        assert!(path.contains("Application Support") || path.contains("sumptus"));
    }

    #[test]
    fn resolve_duckdb_path_prefers_explicit_over_default() {
        let p = Config::resolve_duckdb_path(Some("md:cloud-db"));
        assert_eq!(p, "md:cloud-db");
        let local = Config::resolve_duckdb_path(Some(""));
        // empty explicit falls through to env or default
        assert!(!local.is_empty());
    }

    #[test]
    fn round_trip_toml_preserves_values() {
        let original = Config {
            clickhouse: ClickHouseConfig {
                host: "h".into(),
                port: 1,
                user: "u".into(),
                password: "p".into(),
                database: "d".into(),
                protocol: "http".into(),
            },
            importer: ImporterConfig {
                machine_name: Some("m".into()),
                days_back: Some(3),
                ..ImporterConfig::default()
            },
            ui: UiConfig::default(),
        };
        let toml_str = toml::to_string_pretty(&original).unwrap();
        let parsed: Config = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.clickhouse.host, "h");
        assert_eq!(parsed.importer.machine_name.as_deref(), Some("m"));
        assert_eq!(parsed.importer.days_back, Some(3));
    }

    #[test]
    fn load_missing_file_returns_defaults() {
        let _guard = EnvGuard::new(&[
            "CH_HOST",
            "CH_PORT",
            "CH_USER",
            "CH_PASSWORD",
            "CH_DATABASE",
            "CH_PROTOCOL",
            "DUCKDB_PATH",
            "IMPORT_MACHINE_NAME",
            CONFIG_ENV,
            LEGACY_CONFIG_ENV,
            CREDENTIALS_ENV,
        ]);
        std::env::set_var(CONFIG_ENV, "/tmp/does-not-exist-sumptus.toml");
        let cfg = Config::load(None).unwrap();
        assert!(cfg.clickhouse.host.is_empty());
    }

    #[test]
    fn credentials_candidate_paths_include_xdg() {
        let paths = Credentials::candidate_paths();
        assert!(paths.iter().any(|p| p.ends_with("credentials.toml")));
    }
}
