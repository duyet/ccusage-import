use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, bail, Context};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const DEFAULT_REPO: &str = "duyet/summa";
const GH_API: &str = "https://api.github.com";
const USER_AGENT: &str = "summa-update";
/// Workflows that upload `summa-<target>` artifacts. Master CI (`ci.yml`)
/// publishes linux-amd64 on every push; `release.yml` publishes all OS/arch.
pub const UPDATE_WORKFLOWS: &[&str] = &["ci.yml", "release.yml"];

#[derive(Parser, Debug, Clone)]
pub struct UpdateArgs {
    /// Print actions only; do not download or replace the binary
    #[arg(long)]
    pub dry_run: bool,
    /// GitHub owner/repo (default: duyet/summa)
    #[arg(long)]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallState {
    pub source: String,
    pub run_id: u64,
    pub head_sha: String,
    pub target: String,
    pub sha256: String,
    pub artifact_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRun {
    pub id: u64,
    pub head_sha: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactMeta {
    pub id: u64,
    pub name: String,
}

/// OS/arch triple used by the Release workflow asset names.
pub fn detect_target() -> anyhow::Result<String> {
    let os = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        other => bail!("unsupported OS for prebuilt summa: {other}"),
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => bail!("unsupported architecture for prebuilt summa: {other}"),
    };
    Ok(format!("{arch}-{os}"))
}

pub fn artifact_name_for_target(target: &str) -> String {
    format!("summa-{target}")
}

pub fn should_install(current_sha256: Option<&str>, incoming_sha256: &str) -> bool {
    if incoming_sha256.is_empty() {
        return false;
    }
    match current_sha256 {
        None => true,
        Some(cur) => !cur.eq_ignore_ascii_case(incoming_sha256),
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    Ok(sha256_hex(&bytes))
}

/// Successful completed runs from a GitHub Actions workflow-runs JSON body.
pub fn parse_successful_runs(json: &str) -> anyhow::Result<Vec<WorkflowRun>> {
    let v: serde_json::Value = serde_json::from_str(json).context("parse workflow runs json")?;
    let Some(runs) = v.get("workflow_runs").and_then(|r| r.as_array()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for run in runs {
        let conclusion = run.get("conclusion").and_then(|c| c.as_str()).unwrap_or("");
        let status = run.get("status").and_then(|s| s.as_str()).unwrap_or("");
        if status != "completed" || conclusion != "success" {
            continue;
        }
        let id = run.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
        let head_sha = run
            .get("head_sha")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        if id == 0 || head_sha.is_empty() {
            continue;
        }
        let created_at = run
            .get("created_at")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        out.push(WorkflowRun {
            id,
            head_sha,
            created_at,
        });
    }
    Ok(out)
}

/// First successful completed run (API lists newest first).
pub fn parse_latest_successful_run(json: &str) -> anyhow::Result<Option<WorkflowRun>> {
    Ok(parse_successful_runs(json)?.into_iter().next())
}

/// Newest successful run across one or more workflow-run listings.
pub fn pick_newest_run(runs: impl IntoIterator<Item = WorkflowRun>) -> Option<WorkflowRun> {
    runs.into_iter().max_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    })
}

/// Find a non-expired artifact whose name matches `want`.
pub fn parse_artifact_by_name(json: &str, want: &str) -> anyhow::Result<Option<ArtifactMeta>> {
    let v: serde_json::Value = serde_json::from_str(json).context("parse artifacts json")?;
    let Some(arts) = v.get("artifacts").and_then(|a| a.as_array()) else {
        return Ok(None);
    };
    for a in arts {
        let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let expired = a.get("expired").and_then(|e| e.as_bool()).unwrap_or(false);
        if expired || name != want {
            continue;
        }
        let id = a.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
        if id == 0 {
            continue;
        }
        return Ok(Some(ArtifactMeta {
            id,
            name: name.to_string(),
        }));
    }
    Ok(None)
}

pub fn default_state_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("summa")
        .join("install-state.json")
}

pub fn default_install_path() -> PathBuf {
    if let Ok(dir) = std::env::var("SUMMA_INSTALL_DIR") {
        return PathBuf::from(dir).join("summa");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
        .join("summa")
}

pub fn load_state(path: &Path) -> Option<InstallState> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_state(path: &Path, state: &InstallState) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(state)?;
    fs::write(path, text)?;
    Ok(())
}

pub fn github_token() -> Option<String> {
    for key in ["SUMMA_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    let out = Command::new("gh").args(["auth", "token"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

pub async fn run(args: UpdateArgs) -> anyhow::Result<()> {
    let repo = args
        .repo
        .unwrap_or_else(|| DEFAULT_REPO.to_string());
    let target = detect_target()?;
    let artifact_name = artifact_name_for_target(&target);
    let install_path = default_install_path();
    let state_path = default_state_path();
    let current_state = load_state(&state_path);
    let current_sha = if install_path.is_file() {
        sha256_file(&install_path).ok()
    } else {
        None
    };

    println!("update: target={target} install={}", install_path.display());

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()?;
    let token = github_token();

    let (run, artifact) = match resolve_ci_artifact(&client, token.as_deref(), &repo, &artifact_name)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("update: CI artifact lookup failed: {e}");
            bail!("could not resolve a CI artifact for {artifact_name}");
        }
    };

    if let Some(st) = &current_state {
        if st.run_id == run.id && st.artifact_name == artifact_name {
            if let Some(cur) = &current_sha {
                if !should_install(Some(cur), &st.sha256) {
                    println!(
                        "update: already current (run {} sha {})",
                        run.id, &st.sha256[..12.min(st.sha256.len())]
                    );
                    return Ok(());
                }
            }
        }
    }

    if args.dry_run {
        println!(
            "dry-run: would install {artifact_name} from run {} ({})",
            run.id, run.head_sha
        );
        return Ok(());
    }

    let token = token.ok_or_else(|| {
        anyhow!("GitHub token required to download Actions artifacts (SUMMA_GITHUB_TOKEN / GH_TOKEN / gh auth)")
    })?;

    let tmp = tempfile::tempdir()?;
    let zip_path = tmp.path().join("artifact.zip");
    download_artifact_zip(&client, &token, &repo, artifact.id, &zip_path).await?;
    let bin = extract_summa_from_artifact_zip(&zip_path, tmp.path())?;
    let incoming_sha = sha256_file(&bin)?;

    if !should_install(current_sha.as_deref(), &incoming_sha) {
        let state = InstallState {
            source: "ci".into(),
            run_id: run.id,
            head_sha: run.head_sha,
            target,
            sha256: incoming_sha,
            artifact_name,
        };
        save_state(&state_path, &state)?;
        println!("update: already current (same sha256)");
        return Ok(());
    }

    install_binary(&bin, &install_path)?;
    sync_repo_release_copy(&install_path)?;

    let state = InstallState {
        source: "ci".into(),
        run_id: run.id,
        head_sha: run.head_sha,
        target,
        sha256: incoming_sha.clone(),
        artifact_name,
    };
    save_state(&state_path, &state)?;
    println!(
        "update: installed {} (run {} {})",
        install_path.display(),
        run.id,
        &incoming_sha[..12]
    );
    Ok(())
}

async fn resolve_ci_artifact(
    client: &reqwest::Client,
    token: Option<&str>,
    repo: &str,
    artifact_name: &str,
) -> anyhow::Result<(WorkflowRun, ArtifactMeta)> {
    let mut candidates: Vec<(WorkflowRun, ArtifactMeta)> = Vec::new();
    for workflow in UPDATE_WORKFLOWS {
        let runs_url = format!(
            "{GH_API}/repos/{repo}/actions/workflows/{workflow}/runs?status=completed&per_page=10"
        );
        let runs_body = match gh_get(client, token, &runs_url).await {
            Ok(b) => b,
            Err(e) => {
                eprintln!("update: skip {workflow}: {e}");
                continue;
            }
        };
        for run in parse_successful_runs(&runs_body)? {
            let arts_url = format!("{GH_API}/repos/{repo}/actions/runs/{}/artifacts", run.id);
            let arts_body = match gh_get(client, token, &arts_url).await {
                Ok(b) => b,
                Err(_) => continue,
            };
            if let Some(artifact) = parse_artifact_by_name(&arts_body, artifact_name)? {
                candidates.push((run, artifact));
                break;
            }
        }
    }
    let (run, artifact) = candidates
        .into_iter()
        .max_by(|(a, _), (b, _)| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        })
        .ok_or_else(|| anyhow!("no successful CI/Release artifact named {artifact_name}"))?;
    Ok((run, artifact))
}

async fn gh_get(
    client: &reqwest::Client,
    token: Option<&str>,
    url: &str,
) -> anyhow::Result<String> {
    let mut req = client
        .get(url)
        .header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        bail!("GET {url} -> {status}: {}", text.chars().take(200).collect::<String>());
    }
    Ok(text)
}

async fn download_artifact_zip(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    artifact_id: u64,
    dest: &Path,
) -> anyhow::Result<()> {
    let url = format!("{GH_API}/repos/{repo}/actions/artifacts/{artifact_id}/zip");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?;
    let bytes = resp.bytes().await?;
    fs::write(dest, &bytes)?;
    Ok(())
}

fn extract_summa_from_artifact_zip(zip_path: &Path, dest_dir: &Path) -> anyhow::Result<PathBuf> {
    let unzip_status = Command::new("unzip")
        .args(["-o", "-q"])
        .arg(zip_path)
        .arg("-d")
        .arg(dest_dir)
        .status()
        .context("unzip")?;
    if !unzip_status.success() {
        bail!("unzip failed");
    }
    let tar = find_named(dest_dir, ".tar.gz")
        .ok_or_else(|| anyhow!("artifact zip did not contain a .tar.gz"))?;
    let extract_dir = dest_dir.join("unpacked");
    fs::create_dir_all(&extract_dir)?;
    let tar_status = Command::new("tar")
        .args(["-xzf"])
        .arg(&tar)
        .arg("-C")
        .arg(&extract_dir)
        .status()
        .context("tar")?;
    if !tar_status.success() {
        bail!("tar extract failed");
    }
    find_named(&extract_dir, "summa")
        .or_else(|| find_file_named(&extract_dir, "summa"))
        .ok_or_else(|| anyhow!("archive did not contain summa"))
}

fn find_named(dir: &Path, suffix_or_name: &str) -> Option<PathBuf> {
    let mut found = None;
    if let Ok(walk) = fs::read_dir(dir) {
        for e in walk.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == suffix_or_name || name.ends_with(suffix_or_name) {
                found = Some(p);
                break;
            }
        }
    }
    found
}

fn find_file_named(dir: &Path, name: &str) -> Option<PathBuf> {
    fn rec(dir: &Path, name: &str) -> Option<PathBuf> {
        for e in fs::read_dir(dir).ok()?.flatten() {
            let p = e.path();
            if p.is_dir() {
                if let Some(h) = rec(&p, name) {
                    return Some(h);
                }
            } else if p.file_name().and_then(|n| n.to_str()) == Some(name) {
                return Some(p);
            }
        }
        None
    }
    rec(dir, name)
}

fn install_binary(src: &Path, dest: &Path) -> anyhow::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("summa.new");
    fs::copy(src, &tmp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tmp)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp, perms)?;
    }
    fs::rename(&tmp, dest).or_else(|_| {
        fs::remove_file(dest).ok();
        fs::rename(&tmp, dest)
    })?;
    Ok(())
}

fn sync_repo_release_copy(installed: &Path) -> anyhow::Result<()> {
    let cwd_copy = PathBuf::from("target/release/summa");
    if cwd_copy.exists() || Path::new("Cargo.toml").exists() && Path::new("target/release").is_dir()
    {
        if let Some(parent) = cwd_copy.parent() {
            fs::create_dir_all(parent)?;
        }
        let _ = install_binary(installed, &cwd_copy);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_target_matches_release_asset_shape() {
        let t = detect_target().expect("host should be a supported target");
        assert!(
            t.ends_with("-apple-darwin") || t.ends_with("-unknown-linux-gnu"),
            "unexpected target {t}"
        );
        assert!(t.starts_with("aarch64-") || t.starts_with("x86_64-"), "{t}");
        assert_eq!(artifact_name_for_target(&t), format!("summa-{t}"));
    }

    #[test]
    fn should_install_empty_incoming_is_false() {
        assert!(!should_install(None, ""));
        assert!(!should_install(Some("abc"), ""));
    }

    #[test]
    fn should_install_missing_current() {
        assert!(should_install(None, "abc"));
    }

    #[test]
    fn should_install_same_hash_is_noop() {
        assert!(!should_install(Some("AaBb"), "aabb"));
    }

    #[test]
    fn should_install_different_hash() {
        assert!(should_install(Some("aaaa"), "bbbb"));
    }

    #[test]
    fn sha256_hex_known_vector() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"summa"),
            "b44233a2f7cd626f6e8ddce9939e127388251740504e4af932fb75066509fa44"
        );
    }

    #[test]
    fn parse_latest_successful_run_skips_failures() {
        let json = r#"{
          "workflow_runs": [
            {"id": 1, "head_sha": "aaa", "status": "completed", "conclusion": "failure"},
            {"id": 2, "head_sha": "bbb", "status": "in_progress", "conclusion": null},
            {"id": 99, "head_sha": "ccc111", "status": "completed", "conclusion": "success"}
          ]
        }"#;
        let run = parse_latest_successful_run(json).unwrap().unwrap();
        assert_eq!(run.id, 99);
        assert_eq!(run.head_sha, "ccc111");
    }

    #[test]
    fn update_workflows_include_master_ci_and_release() {
        assert!(UPDATE_WORKFLOWS.contains(&"ci.yml"));
        assert!(UPDATE_WORKFLOWS.contains(&"release.yml"));
    }

    #[test]
    fn pick_newest_run_prefers_later_ci_over_older_release() {
        let ci = r#"{
          "workflow_runs": [
            {"id": 200, "head_sha": "newci", "status": "completed", "conclusion": "success",
             "created_at": "2026-08-17T07:00:00Z"}
          ]
        }"#;
        let release = r#"{
          "workflow_runs": [
            {"id": 100, "head_sha": "oldrel", "status": "completed", "conclusion": "success",
             "created_at": "2026-08-17T06:00:00Z"}
          ]
        }"#;
        let mut runs = parse_successful_runs(ci).unwrap();
        runs.extend(parse_successful_runs(release).unwrap());
        let picked = pick_newest_run(runs).unwrap();
        assert_eq!(picked.id, 200);
        assert_eq!(picked.head_sha, "newci");
    }

    #[test]
    fn parse_latest_successful_run_empty() {
        assert!(parse_latest_successful_run(r#"{"workflow_runs":[]}"#)
            .unwrap()
            .is_none());
    }

    #[test]
    fn parse_artifact_skips_expired_and_wrong_name() {
        let json = r#"{
          "artifacts": [
            {"id": 1, "name": "summa-x86_64-unknown-linux-gnu", "expired": false},
            {"id": 2, "name": "summa-aarch64-apple-darwin", "expired": true},
            {"id": 3, "name": "summa-aarch64-apple-darwin", "expired": false}
          ]
        }"#;
        let a = parse_artifact_by_name(json, "summa-aarch64-apple-darwin")
            .unwrap()
            .unwrap();
        assert_eq!(a.id, 3);
        assert!(parse_artifact_by_name(json, "summa-nope").unwrap().is_none());
    }

    #[test]
    fn state_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("install-state.json");
        let st = InstallState {
            source: "ci".into(),
            run_id: 42,
            head_sha: "deadbeef".into(),
            target: "aarch64-apple-darwin".into(),
            sha256: "abc".into(),
            artifact_name: "summa-aarch64-apple-darwin".into(),
        };
        save_state(&path, &st).unwrap();
        assert_eq!(load_state(&path).unwrap(), st);
    }
}
