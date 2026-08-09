use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser, Debug, Clone)]
pub struct CronjobArgs {
    /// Install/remove/show the scheduled import job
    #[command(subcommand)]
    pub action: CronjobAction,
}

#[derive(Subcommand, Debug, Clone)]
pub enum CronjobAction {
    /// Install a daily cron job for `summa import`
    Install,
    /// Remove the scheduled cron job
    Remove,
    /// Show whether a cron job is installed
    Status,
}

pub async fn run(args: CronjobArgs) -> anyhow::Result<()> {
    let bin = std::env::current_exe()?;

    match args.action {
        CronjobAction::Install => install_cron(&bin).await,
        CronjobAction::Remove => remove_cron().await,
        CronjobAction::Status => show_status().await,
    }
}

async fn install_cron(bin: &PathBuf) -> anyhow::Result<()> {
    let entry = format!(
        "0 8 * * * {} import --days-back=1 >> $HOME/.summa/cron.log 2>&1",
        bin.display()
    );

    use std::process::Command;
    let crontab = Command::new("crontab").arg("-l").output();

    let mut lines: Vec<String> = match crontab {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|l| !l.contains("summa import"))
                .map(String::from)
                .collect()
        }
        _ => Vec::new(),
    };

    lines.push(entry);

    let combined = lines.join("\n") + "\n";
    std::fs::write("/tmp/summa_cron_install", combined)?;

    Command::new("crontab")
        .arg("/tmp/summa_cron_install")
        .status()?;

    std::fs::remove_file("/tmp/summa_cron_install").ok();

    println!("cron job installed: daily at 08:00");
    println!("  bin: {}", bin.display());
    println!("  log: $HOME/.summa/cron.log");
    Ok(())
}

async fn remove_cron() -> anyhow::Result<()> {
    use std::process::Command;
    let crontab = Command::new("crontab").arg("-l").output()?;

    if !crontab.status.success() {
        println!("no cron job found");
        return Ok(());
    }

    let stdout_str = String::from_utf8_lossy(&crontab.stdout).into_owned();
    let lines: Vec<&str> = stdout_str
        .lines()
        .filter(|l| !l.contains("summa import"))
        .collect();

    let combined = lines.join("\n");
    std::fs::write("/tmp/summa_cron_remove", combined + "\n")?;

    Command::new("crontab")
        .arg("/tmp/summa_cron_remove")
        .status()?;

    std::fs::remove_file("/tmp/summa_cron_remove").ok();

    println!("cron job removed");
    Ok(())
}

async fn show_status() -> anyhow::Result<()> {
    use std::process::Command;
    let crontab = Command::new("crontab").arg("-l").output()?;

    if !crontab.status.success() {
        println!("no cron tab found");
        return Ok(());
    }

    let has_job = String::from_utf8_lossy(&crontab.stdout)
        .lines()
        .any(|l| l.contains("summa import"));

    if has_job {
        println!("cron job: installed");
        println!("  schedule: daily at 08:00");
    } else {
        println!("cron job: not installed");
    }
    Ok(())
}
