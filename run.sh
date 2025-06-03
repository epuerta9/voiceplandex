#!/bin/bash

# Voice Plandex Startup Script
# This script helps you start Voice Plandex with proper configuration

set -e

echo "🎤 Voice Plandex - Hands-free AI Coding Assistant"
echo "=================================================="

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  WARNING: OPENAI_API_KEY environment variable is not set!"
    echo "   Voice features will not work without an OpenAI API key."
    echo "   Set it with: export OPENAI_API_KEY=\"your-api-key\""
    echo ""
fi

# Check if Plandex is installed
if ! command -v plandex &> /dev/null; then
    echo "❌ ERROR: Plandex CLI is not installed or not in PATH"
    echo "   Install it from: https://plandex.ai"
    echo "   Or run: curl -sL https://plandex.ai/install.sh | bash"
    exit 1
fi

echo "✅ Plandex CLI found: $(which plandex)"

# Build if needed
if [ ! -f "./voiceagent" ]; then
    echo "🔨 Building Voice Plandex..."
    CGO_ENABLED=0 go build -ldflags="-s -w" -o voiceagent
    echo "✅ Build complete"
fi

# Determine run mode
DEVELOPMENT=${DEVELOPMENT:-"false"}
if [ "$DEVELOPMENT" = "true" ] || [ "$1" = "--dev" ]; then
    echo "🔧 Starting in DEVELOPMENT mode (insecure, no TLS)"
    echo "   Access at: http://localhost:8000"
    echo "   Press Ctrl+C to stop"
    echo ""
    INSECURE=true ADDR=:8000 ./voiceagent
else
    echo "🔒 Starting in PRODUCTION mode (requires TLS certificates)"
    
    # Check for TLS certificates
    if [ ! -f "cert.pem" ] || [ ! -f "key.pem" ]; then
        echo "⚠️  TLS certificates not found. Generating self-signed certificates..."
        openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
            -subj "/CN=localhost" -days 365 -batch
        echo "✅ Self-signed certificates generated"
    fi
    
    echo "   Access at: https://localhost"
    echo "   Press Ctrl+C to stop"
    echo ""
    ./voiceagent
fi 