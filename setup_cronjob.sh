#!/bin/bash
set -e

# ccusage-import Cronjob Setup Script
# Sets up automated hourly imports
#
# Usage: ./setup_cronjob.sh [-f|--force]
#   -f, --force    Force overwrite existing cronjob without prompting

FORCE=false
SHOW_STATUS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--force)
            FORCE=true
            shift
            ;;
        -s|--status)
            SHOW_STATUS=true
            shift
            ;;
        -h|--help)
            echo "ccusage-import Cronjob Setup"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -f, --force      Force overwrite existing cronjob without prompting"
            echo "  -s, --status     Show current cronjob status and exit"
            echo "  -h, --help       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0               # Interactive setup"
            echo "  $0 -f            # Force overwrite"
            echo "  $0 -s            # Show status"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [-f|--force] [-s|--status] [-h|--help]"
            exit 1
            ;;
    esac
done

# Show status and exit if requested
if [ "$SHOW_STATUS" = true ]; then
    echo "📊 Current cronjob status:"
    echo ""
    if crontab -l 2>/dev/null | grep -q "ccusage-import"; then
        echo "✅ ccusage-import cronjob is installed:"
        echo ""
        crontab -l 2>/dev/null | grep "ccusage-import" | while read -r line; do
            echo "  $line"
        done
        echo ""
        echo "📝 Log file: $PROJECT_DIR/logs/ccusage-import.log"
        if [ -f "$PROJECT_DIR/logs/ccusage-import.log" ]; then
            echo "📊 Log size: $(wc -l < "$PROJECT_DIR/logs/ccusage-import.log") lines"
            echo "🕒 Last entry:"
            tail -1 "$PROJECT_DIR/logs/ccusage-import.log" 2>/dev/null | sed 's/^/    /'
        fi
    else
        echo "⚠️  No ccusage-import cronjob found"
        echo ""
        echo "To install, run: $0"
    fi
    exit 0
fi

echo "⏰ Setting up ccusage-import cronjob..."

# Detect shell and config file
SHELL_NAME="$(basename "$SHELL")"
CRON_ENTRY=""

case "$SHELL_NAME" in
    bash)
        CONFIG_FILE="$HOME/.bashrc"
        ;;
    zsh)
        CONFIG_FILE="$HOME/.zshrc"
        ;;
    fish)
        CONFIG_FILE="$HOME/.config/fish/config.fish"
        ;;
    *)
        CONFIG_FILE="$HOME/.profile"
        ;;
esac

# Get the project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📂 Project directory: $PROJECT_DIR"
echo "📁 Shell config: $CONFIG_FILE"

# Check if environment variables are set
if [ -z "$CH_HOST" ] || [ -z "$CH_USER" ] || [ -z "$CH_PASSWORD" ] || [ -z "$CH_DATABASE" ]; then
    echo ""
    echo "⚠️  ClickHouse environment variables not set!"
    echo ""
    echo "Please set them first:"
    echo "  export CH_HOST='your-host'"
    echo "  export CH_PORT='8123'"
    echo "  export CH_USER='your-user'"
    echo "  export CH_PASSWORD='your-password'"
    echo "  export CH_DATABASE='your-database'"
    echo ""
    echo "Then add them to $CONFIG_FILE for persistence."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Detect node/bun binary
if command -v bun &> /dev/null; then
    RUNNER="bun"
    echo "✅ Detected bun runtime"
elif command -v node &> /dev/null; then
    RUNNER="node"
    echo "✅ Detected node runtime"
else
    echo "❌ No Node.js runtime found"
    exit 1
fi

# Log file setup
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ccusage-import.log"

echo "📝 Log file: $LOG_FILE"

# Get npx/bunx path
if command -v npx &> /dev/null; then
    NPX_PATH="$(which npx)"
elif command -v bunx &> /dev/null; then
    NPX_PATH="$(which bunx)"
else
    NPX_PATH="npx"  # fallback
fi

# Detect PATH for cron
CRON_PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

if [ -d "$HOME/.bun" ]; then
    CRON_PATH="$HOME/.bun/bin:$CRON_PATH"
fi

# Create cron entry
# Run hourly at minute 0
CRON_ENTRY="0 * * * * PATH=\"$CRON_PATH\" cd \"$PROJECT_DIR\" && $RUNNER src/cli.ts import --quiet >> \"$LOG_FILE\" 2>&1"

echo ""
echo "Cron entry to be added:"
echo "  $CRON_ENTRY"
echo ""

# Check if crontab exists and has ccusage-import entry
if crontab -l 2>/dev/null | grep -q "ccusage-import"; then
    echo "⚠️  Found existing ccusage-import cronjob"
    if [ "$FORCE" = true ]; then
        echo "🔄 Force mode: replacing existing cronjob"
        # Remove existing entry
        crontab -l 2>/dev/null | grep -v "ccusage-import" | crontab -
        # Add new entry
        (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
        echo "✅ Cronjob updated"
    else
        read -p "Replace it? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Remove existing entry
            crontab -l 2>/dev/null | grep -v "ccusage-import" | crontab -
            # Add new entry
            (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
            echo "✅ Cronjob updated"
        else
            echo "Skipped cronjob setup"
        fi
    fi
else
    # Add new entry
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "✅ Cronjob installed"
fi

# Create logrotate config
LOGROTATE_CONF="$PROJECT_DIR/logrotate.conf"
cat > "$LOGROTATE_CONF" << LOGROTATE
$LOG_FILE {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 $USER $USER
}
LOGROTATE

echo "📝 Created logrotate config: $LOGROTATE_CONF"

# Add logrotate to cron if not exists
if ! crontab -l 2>/dev/null | grep -q "logrotate.*ccusage-import"; then
    LOGROTATE_ENTRY="0 0 * * * /usr/sbin/logrotate -s \"$PROJECT_DIR/logrotate.status\" \"$LOGROTATE_CONF\" >> \"$LOG_FILE\" 2>&1"
    (crontab -l 2>/dev/null; echo "$LOGROTATE_ENTRY") | crontab -
    echo "✅ Log rotation cronjob added"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Your import will run hourly. View logs with:"
echo "  tail -f $LOG_FILE"
echo ""
echo "To list cronjobs:"
echo "  crontab -l"
echo ""
echo "To remove the cronjob:"
echo "  crontab -e   # and delete the ccusage-import lines"
