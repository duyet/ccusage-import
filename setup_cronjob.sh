#!/bin/bash
# Setup cronjob for ccusage data import to ClickHouse

PROJECT_DIR="/Users/duet/project/ccusage-import"
SCRIPT_PATH="$PROJECT_DIR/ccusage_importer.py"

# Detect uv path dynamically
UV_PATH=$(which uv)
if [ -z "$UV_PATH" ]; then
    echo "❌ uv not found in PATH. Please install uv first."
    exit 1
fi

# Check if project directory exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Project directory not found: $PROJECT_DIR"
    exit 1
fi

# Check if script exists
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ Script not found: $SCRIPT_PATH"
    exit 1
fi

# Create log directory and set permissions
mkdir -p "$HOME/.local/log/ccusage"
LOG_DIR="$HOME/.local/log/ccusage"

echo "🔧 Setting up ccusage cronjob..."
echo "📁 Project: $PROJECT_DIR"  
echo "📜 Script: $SCRIPT_PATH"
echo "📋 Logs: $LOG_DIR"
echo "🔗 UV Path: $UV_PATH"

# Add cronjob to run every hour with enhanced logging
echo "⏰ Setting up cronjob to run every hour with timestamp logging..."
(crontab -l 2>/dev/null; echo "0 * * * * cd $PROJECT_DIR && echo \"\$(date): Starting ccusage import\" >> $LOG_DIR/import.log && $UV_PATH run python ccusage_importer.py >> $LOG_DIR/import.log 2>&1 && echo \"\$(date): ccusage import completed\" >> $LOG_DIR/import.log") | crontab -

# Run initial import
echo "🚀 Running initial import..."
cd "$PROJECT_DIR" && uv run python ccusage_importer.py

echo ""
echo "✅ Setup completed!"
echo "⏰ Cronjob will run every hour at minute 0"
echo "📝 Enhanced logging with timestamps enabled"
echo ""
echo "📁 Log files:"
echo "   - Main log: $LOG_DIR/import.log"
echo "   - Location: $LOG_DIR/"
echo ""
echo "🔧 Management commands:"
echo "   - View current crontab: crontab -l"
echo "   - View recent logs: tail -f $LOG_DIR/import.log"
echo "   - View log history: ls -la $LOG_DIR/"
echo "   - Test manual run: cd $PROJECT_DIR && uv run python ccusage_importer.py"
echo "   - Remove cronjob: crontab -e (then delete the ccusage line)"
echo ""
echo "🎯 Next steps:"
echo "   1. Verify cronjob: crontab -l | grep ccusage"
echo "   2. Monitor first run: tail -f $LOG_DIR/import.log"
echo "   3. Check ClickHouse data after import"