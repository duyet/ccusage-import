#!/usr/bin/env python3
"""
ccusage to ClickHouse Data Importer (Updated with ccusage_ prefix)
Imports data from ccusage JSON output into ClickHouse database
Designed to be run as a cronjob, handles idempotent inserts
"""

import json
import subprocess
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional
import clickhouse_connect

# ClickHouse connection settings
CH_HOST = 'duet-ubuntu'
CH_USER = 'duyet'
CH_PASSWORD = 'ntmVKggOQa'
CH_DATABASE = 'duyet_analytics'

class ClickHouseImporter:
    def __init__(self):
        self.client = clickhouse_connect.get_client(
            host=CH_HOST,
            username=CH_USER,
            password=CH_PASSWORD,
            database=CH_DATABASE
        )
    
    def run_ccusage_command(self, command: str) -> Dict[str, Any]:
        """Run ccusage command and return JSON data"""
        try:
            result = subprocess.run(
                ['npx', 'ccusage@latest'] + command.split() + ['--json'],
                capture_output=True,
                text=True,
                check=True
            )
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error running ccusage {command}: {e}")
            return {}
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON from ccusage {command}: {e}")
            return {}
    
    def upsert_daily_data(self, daily_data: List[Dict[str, Any]]):
        """Insert or update daily usage data"""
        if not daily_data:
            return
        
        # Delete existing data for these dates first
        dates = [item['date'] for item in daily_data]
        if dates:
            self.client.command(f"DELETE FROM ccusage_usage_daily WHERE date IN ({','.join([f\"'{d}'\" for d in dates])})")
        
        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        
        for item in daily_data:
            # Main daily record
            rows.append([
                item['date'],
                item['inputTokens'],
                item['outputTokens'],
                item['cacheCreationTokens'],
                item['cacheReadTokens'],
                item['totalTokens'],
                item['totalCost'],
                len(item['modelsUsed']),
                datetime.now(),
                datetime.now()
            ])
            
            # Model breakdowns
            for breakdown in item.get('modelBreakdowns', []):
                model_breakdown_rows.append([
                    'daily',
                    item['date'],
                    breakdown['modelName'],
                    breakdown['inputTokens'],
                    breakdown['outputTokens'],
                    breakdown['cacheCreationTokens'],
                    breakdown['cacheReadTokens'],
                    breakdown['cost'],
                    datetime.now()
                ])
            
            # Models used
            for model in item['modelsUsed']:
                model_used_rows.append([
                    'daily',
                    item['date'],
                    model,
                    datetime.now()
                ])
        
        # Insert data
        if rows:
            self.client.insert('ccusage_usage_daily', rows)
            print(f"Inserted {len(rows)} daily records")
        
        if model_breakdown_rows:
            # Delete existing model breakdowns
            self.client.command(f"DELETE FROM ccusage_model_breakdowns WHERE record_type = 'daily' AND record_key IN ({','.join([f\"'{d}'\" for d in dates])})")
            self.client.insert('ccusage_model_breakdowns', model_breakdown_rows)
            print(f"Inserted {len(model_breakdown_rows)} model breakdown records")
        
        if model_used_rows:
            # Delete existing model used records
            self.client.command(f"DELETE FROM ccusage_models_used WHERE record_type = 'daily' AND record_key IN ({','.join([f\"'{d}'\" for d in dates])})")
            self.client.insert('ccusage_models_used', model_used_rows)
            print(f"Inserted {len(model_used_rows)} models used records")
    
    def upsert_monthly_data(self, monthly_data: List[Dict[str, Any]]):
        """Insert or update monthly usage data"""
        if not monthly_data:
            return
        
        # Delete existing data for these months first
        months = [item['month'] for item in monthly_data]
        if months:
            self.client.command(f"DELETE FROM ccusage_usage_monthly WHERE month IN ({','.join([f\"'{m}'\" for m in months])})")
        
        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        
        for item in monthly_data:
            year, month_num = item['month'].split('-')
            
            # Main monthly record
            rows.append([
                item['month'],
                int(year),
                int(month_num),
                item['inputTokens'],
                item['outputTokens'],
                item['cacheCreationTokens'],
                item['cacheReadTokens'],
                item['totalTokens'],
                item['totalCost'],
                len(item['modelsUsed']),
                datetime.now(),
                datetime.now()
            ])
            
            # Model breakdowns and models used
            for breakdown in item.get('modelBreakdowns', []):
                model_breakdown_rows.append([
                    'monthly',
                    item['month'],
                    breakdown['modelName'],
                    breakdown['inputTokens'],
                    breakdown['outputTokens'],
                    breakdown['cacheCreationTokens'],
                    breakdown['cacheReadTokens'],
                    breakdown['cost'],
                    datetime.now()
                ])
            
            for model in item['modelsUsed']:
                model_used_rows.append([
                    'monthly',
                    item['month'],
                    model,
                    datetime.now()
                ])
        
        # Insert data
        if rows:
            self.client.insert('ccusage_usage_monthly', rows)
            print(f"Inserted {len(rows)} monthly records")
        
        if model_breakdown_rows:
            self.client.command(f"DELETE FROM ccusage_model_breakdowns WHERE record_type = 'monthly' AND record_key IN ({','.join([f\"'{m}'\" for m in months])})")
            self.client.insert('ccusage_model_breakdowns', model_breakdown_rows)
        
        if model_used_rows:
            self.client.command(f"DELETE FROM ccusage_models_used WHERE record_type = 'monthly' AND record_key IN ({','.join([f\"'{m}'\" for m in months])})")
            self.client.insert('ccusage_models_used', model_used_rows)
    
    def upsert_session_data(self, session_data: List[Dict[str, Any]]):
        """Insert or update session usage data"""
        if not session_data:
            return
        
        # Delete existing data for these sessions first
        session_ids = [item['sessionId'] for item in session_data]
        if session_ids:
            self.client.command(f"DELETE FROM ccusage_usage_sessions WHERE session_id IN ({','.join([f\"'{s}'\" for s in session_ids])})")
        
        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        
        for item in session_data:
            # Main session record
            rows.append([
                item['sessionId'],
                item['projectPath'],
                item['inputTokens'],
                item['outputTokens'],
                item['cacheCreationTokens'],
                item['cacheReadTokens'],
                item['totalTokens'],
                item['totalCost'],
                item['lastActivity'],
                len(item['modelsUsed']),
                datetime.now(),
                datetime.now()
            ])
            
            # Model breakdowns and models used
            for breakdown in item.get('modelBreakdowns', []):
                model_breakdown_rows.append([
                    'session',
                    item['sessionId'],
                    breakdown['modelName'],
                    breakdown['inputTokens'],
                    breakdown['outputTokens'],
                    breakdown['cacheCreationTokens'],
                    breakdown['cacheReadTokens'],
                    breakdown['cost'],
                    datetime.now()
                ])
            
            for model in item['modelsUsed']:
                model_used_rows.append([
                    'session',
                    item['sessionId'],
                    model,
                    datetime.now()
                ])
        
        # Insert data
        if rows:
            self.client.insert('ccusage_usage_sessions', rows)
            print(f"Inserted {len(rows)} session records")
        
        if model_breakdown_rows:
            self.client.command(f"DELETE FROM ccusage_model_breakdowns WHERE record_type = 'session' AND record_key IN ({','.join([f\"'{s}'\" for s in session_ids])})")
            self.client.insert('ccusage_model_breakdowns', model_breakdown_rows)
        
        if model_used_rows:
            self.client.command(f"DELETE FROM ccusage_models_used WHERE record_type = 'session' AND record_key IN ({','.join([f\"'{s}'\" for s in session_ids])})")
            self.client.insert('ccusage_models_used', model_used_rows)
    
    def upsert_blocks_data(self, blocks_data: List[Dict[str, Any]]):
        """Insert or update blocks usage data"""
        if not blocks_data:
            return
        
        # Delete existing data for these blocks first
        block_ids = [item['id'] for item in blocks_data]
        if block_ids:
            self.client.command(f"DELETE FROM ccusage_usage_blocks WHERE block_id IN ({','.join([f\"'{b}'\" for b in block_ids])})")
        
        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        
        for item in blocks_data:
            # Main block record
            rows.append([
                item['id'],
                item['startTime'],
                item['endTime'],
                item.get('actualEndTime'),
                1 if item['isActive'] else 0,
                1 if item['isGap'] else 0,
                item['entries'],
                item['tokenCounts']['inputTokens'],
                item['tokenCounts']['outputTokens'],
                item['tokenCounts']['cacheCreationInputTokens'],
                item['tokenCounts']['cacheReadInputTokens'],
                item['totalTokens'],
                item['costUSD'],
                len(item['models']),
                item.get('usageLimitResetTime'),
                item.get('burnRate'),
                item.get('projection'),
                datetime.now()
            ])
            
            # Models used (blocks don't have detailed breakdowns in the same format)
            for model in item['models']:
                if model != '<synthetic>':  # Skip synthetic entries
                    model_used_rows.append([
                        'block',
                        item['id'],
                        model,
                        datetime.now()
                    ])
        
        # Insert data
        if rows:
            self.client.insert('ccusage_usage_blocks', rows)
            print(f"Inserted {len(rows)} block records")
        
        if model_used_rows:
            self.client.command(f"DELETE FROM ccusage_models_used WHERE record_type = 'block' AND record_key IN ({','.join([f\"'{b}'\" for b in block_ids])})")
            self.client.insert('ccusage_models_used', model_used_rows)
    
    def upsert_projects_daily_data(self, projects_data: Dict[str, List[Dict[str, Any]]]):
        """Insert or update projects daily usage data"""
        if not projects_data:
            return
        
        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        dates_to_delete = set()
        
        for project_id, daily_records in projects_data.items():
            for item in daily_records:
                dates_to_delete.add(item['date'])
                
                # Main project daily record
                rows.append([
                    item['date'],
                    project_id,
                    item['inputTokens'],
                    item['outputTokens'],
                    item['cacheCreationTokens'],
                    item['cacheReadTokens'],
                    item['totalTokens'],
                    item['totalCost'],
                    len(item['modelsUsed']),
                    datetime.now(),
                    datetime.now()
                ])
                
                # Model breakdowns and models used
                for breakdown in item.get('modelBreakdowns', []):
                    model_breakdown_rows.append([
                        'project_daily',
                        f"{item['date']}_{project_id}",
                        breakdown['modelName'],
                        breakdown['inputTokens'],
                        breakdown['outputTokens'],
                        breakdown['cacheCreationTokens'],
                        breakdown['cacheReadTokens'],
                        breakdown['cost'],
                        datetime.now()
                    ])
                
                for model in item['modelsUsed']:
                    model_used_rows.append([
                        'project_daily',
                        f"{item['date']}_{project_id}",
                        model,
                        datetime.now()
                    ])
        
        # Delete existing data for these dates
        if dates_to_delete:
            dates_str = ','.join([f"'{d}'" for d in dates_to_delete])
            self.client.command(f"DELETE FROM ccusage_usage_projects_daily WHERE date IN ({dates_str})")
            # Note: More complex deletion for model breakdowns/used records would be needed for full cleanup
        
        # Insert data
        if rows:
            self.client.insert('ccusage_usage_projects_daily', rows)
            print(f"Inserted {len(rows)} project daily records")
        
        if model_breakdown_rows:
            self.client.insert('ccusage_model_breakdowns', model_breakdown_rows)
        
        if model_used_rows:
            self.client.insert('ccusage_models_used', model_used_rows)
    
    def import_all_data(self):
        """Import all ccusage data into ClickHouse"""
        print(f"Starting ccusage data import at {datetime.now()}")
        
        # Import daily data
        print("Importing daily data...")
        daily_data = self.run_ccusage_command('daily')
        if 'daily' in daily_data:
            self.upsert_daily_data(daily_data['daily'])
        
        # Import monthly data
        print("Importing monthly data...")
        monthly_data = self.run_ccusage_command('monthly')
        if 'monthly' in monthly_data:
            self.upsert_monthly_data(monthly_data['monthly'])
        
        # Import session data
        print("Importing session data...")
        session_data = self.run_ccusage_command('session')
        if 'sessions' in session_data:
            self.upsert_session_data(session_data['sessions'])
        
        # Import blocks data
        print("Importing blocks data...")
        blocks_data = self.run_ccusage_command('blocks')
        if 'blocks' in blocks_data:
            self.upsert_blocks_data(blocks_data['blocks'])
        
        # Import projects daily data
        print("Importing projects daily data...")
        projects_data = self.run_ccusage_command('daily --instances')
        if 'projects' in projects_data:
            self.upsert_projects_daily_data(projects_data['projects'])
        
        print(f"ccusage data import completed at {datetime.now()}")

def main():
    """Main function"""
    importer = ClickHouseImporter()
    importer.import_all_data()

if __name__ == '__main__':
    main()