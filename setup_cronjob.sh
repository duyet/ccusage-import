#!/bin/bash
# Setup cronjob for ccusage data import to ClickHouse

# Install required Python packages
echo "Installing required Python packages..."
pip3 install clickhouse-connect

# Make the importer script executable
chmod +x /tmp/ccusage_importer.py

# Copy script to a permanent location
sudo cp /tmp/ccusage_importer.py /usr/local/bin/ccusage_importer.py

# Create log directory
sudo mkdir -p /var/log/ccusage

# Add cronjob to run every hour
echo "Setting up cronjob to run every hour..."
(crontab -l 2>/dev/null; echo "0 * * * * /usr/bin/python3 /usr/local/bin/ccusage_importer.py >> /var/log/ccusage/import.log 2>&1") | crontab -

# Run initial import
echo "Running initial import..."
python3 /usr/local/bin/ccusage_importer.py

echo "Setup completed!"
echo "Cronjob will run every hour at minute 0"
echo "Check logs at: /var/log/ccusage/import.log"
echo "To view current crontab: crontab -l"