#!/usr/bin/env bash
echo "========================================================"
echo "  Drop Harbor - Self-Hosted File Drop"
echo "  Kitsune Technologies LLC"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js was not found on your system."
    echo "Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --omit=dev
fi

if [ ! -f ".env" ]; then
    echo "Creating default .env configuration..."
    cp .env.example .env
fi

echo "Starting Drop Harbor at http://localhost:3000 ..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000 &
elif command -v open >/dev/null 2>&1; then
    open http://localhost:3000 &
fi

node server.js
