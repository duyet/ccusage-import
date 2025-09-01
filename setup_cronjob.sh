#!/bin/bash
# Setup cronjob for ccusage data import to ClickHouse

# Install required Python packages
echo "Installing required Python packages..."
pip3 install clickhouse-connect

# Make the importer script executable
chmod +x /tmp/ccusage_importer.py

# Copy script to a permanent location
sudo cp /tmp/ccusage_importer.py /usr/local/bin/ccusage_importer.py

# Create log directory and set permissions
sudo mkdir -p /var/log/ccusage
sudo chown $USER:$USER /var/log/ccusage

# Add cronjob to run every hour with enhanced logging
echo "Setting up cronjob to run every hour with timestamp logging..."
(crontab -l 2>/dev/null; echo "0 * * * * echo \"\$(date): Starting ccusage import\" >> /var/log/ccusage/import.log && /usr/bin/python3 /usr/local/bin/ccusage_importer.py >> /var/log/ccusage/import.log 2>&1 && echo \"\$(date): ccusage import completed\" >> /var/log/ccusage/import.log") | crontab -

# Run initial import
echo "Running initial import..."
python3 /usr/local/bin/ccusage_importer.py

# Create logrotate configuration to prevent logs from growing too large
sudo tee /etc/logrotate.d/ccusage > /dev/null << 'EOF'
/var/log/ccusage/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644
}
EOF

echo "Setup completed!"
echo "Cronjob will run every hour at minute 0"
echo "Enhanced logging with timestamps enabled"
echo ""
echo "📁 Log files:"
echo "   - Main log: /var/log/ccusage/import.log"
echo "   - Rotation: 30 days, daily compression"
echo ""
echo "🔧 Management commands:"
echo "   - View current crontab: crontab -l"
echo "   - View recent logs: tail -f /var/log/ccusage/import.log"
echo "   - View log history: ls -la /var/log/ccusage/"
echo "   - Test manual run: /usr/bin/python3 /usr/local/bin/ccusage_importer.py"