#!/bin/bash
set -e

# ccusage-import TypeScript Installer
# Run with: curl -sSL https://raw.githubusercontent.com/duyet/ccusage-import/main/install.sh | bash

echo "🚀 Installing ccusage-import (TypeScript version)..."

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js 20+ is required (found: $(node -v))"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ Node.js $(node -v) found"
echo "✅ npm $(npm -v) found"

# Create installation directory
INSTALL_DIR="$HOME/.ccusage-import"
mkdir -p "$INSTALL_DIR"

echo "📦 Installing dependencies..."
cd /tmp
rm -rf ccusage-import-temp
git clone https://github.com/duyet/ccusage-import.git ccusage-import-temp
cd ccusage-import-temp

npm install

echo "🔨 Building project..."
npm run build || echo "⚠️  Build failed, but dependencies installed"

# Install globally
echo "📍 Installing globally..."
npm link

echo ""
echo "✅ Installation complete!"
echo ""
echo "To get started:"
echo "  1. Set up your ClickHouse credentials:"
echo "     export CH_HOST='your-host'"
echo "     export CH_PORT='8123'"
echo "     export CH_USER='your-user'"
echo "     export CH_PASSWORD='your-password'"
echo "     export CH_DATABASE='your-database'"
echo ""
echo "  2. Run the import:"
echo "     ccusage-import import"
echo ""
echo "  3. Run system check:"
echo "     ccusage-import check"
echo ""
echo "For cron setup, run:"
echo "  ./setup_cronjob.sh"
