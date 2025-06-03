#!/bin/bash

# Voice Plandex Troubleshooting Script
# Helps diagnose and fix common issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

echo_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_plandex_cli() {
    echo_header "🔍 CHECKING PLANDEX CLI"
    
    if command -v plandex >/dev/null 2>&1; then
        echo_success "Plandex CLI is installed: $(which plandex)"
        
        if plandex version >/dev/null 2>&1; then
            echo_success "Plandex CLI is working: $(plandex version)"
        else
            echo_error "Plandex CLI found but not working"
            echo_info "Try: plandex server start"
            return 1
        fi
    else
        echo_error "Plandex CLI not found in PATH"
        echo_info "Install with: curl -sL https://plandex.ai/install.sh | bash"
        return 1
    fi
}

check_plandex_server() {
    echo_header "🔍 CHECKING PLANDEX SERVER"
    
    if plandex version >/dev/null 2>&1; then
        echo_success "Plandex server is running"
    else
        echo_error "Plandex server is not running"
        echo_info "Starting Plandex server..."
        
        if plandex server start; then
            sleep 3
            if plandex version >/dev/null 2>&1; then
                echo_success "Plandex server started successfully"
            else
                echo_error "Failed to start Plandex server"
                return 1
            fi
        else
            echo_error "Failed to start Plandex server"
            return 1
        fi
    fi
}

check_openai_api() {
    echo_header "🔍 CHECKING OPENAI API KEY"
    
    if [ -n "$OPENAI_API_KEY" ]; then
        echo_success "OpenAI API key is set ($(echo $OPENAI_API_KEY | cut -c1-10)...)"
        
        # Test API key with a simple request
        echo_info "Testing OpenAI API connection..."
        if curl -s -H "Authorization: Bearer $OPENAI_API_KEY" \
                -H "Content-Type: application/json" \
                "https://api.openai.com/v1/models" | grep -q "whisper"; then
            echo_success "OpenAI API key is valid and Whisper is available"
        else
            echo_warning "OpenAI API key may be invalid or API is down"
        fi
    else
        echo_error "OpenAI API key not set"
        echo_info "Set with: export OPENAI_API_KEY=\"sk-your-api-key-here\""
        return 1
    fi
}

check_voice_plandex() {
    echo_header "🔍 CHECKING VOICE PLANDEX"
    
    if [ -f "./voiceagent" ]; then
        echo_success "Voice Plandex binary found"
        
        if ./manage.sh status | grep -q "running"; then
            echo_success "Voice Plandex is running"
            echo_info "Access at: http://localhost:8000"
        else
            echo_warning "Voice Plandex is not running"
            echo_info "Start with: ./manage.sh start"
        fi
    else
        echo_error "Voice Plandex binary not found"
        echo_info "Build with: ./manage.sh build"
        return 1
    fi
}

check_ports() {
    echo_header "🔍 CHECKING PORTS"
    
    # Check if port 8000 is in use
    if netstat -ln 2>/dev/null | grep -q ":8000 "; then
        echo_info "Port 8000 is in use (Voice Plandex)"
    else
        echo_warning "Port 8000 is not in use"
    fi
    
    # Check if port 8099 is in use (Plandex server)
    if netstat -ln 2>/dev/null | grep -q ":8099 "; then
        echo_info "Port 8099 is in use (Plandex server)"
    else
        echo_warning "Port 8099 is not in use (Plandex server may not be running)"
    fi
}

fix_common_issues() {
    echo_header "🔧 FIXING COMMON ISSUES"
    
    echo_info "Attempting to fix common issues..."
    
    # Kill any orphaned processes
    echo_info "Cleaning up orphaned processes..."
    pkill -f "voiceagent" 2>/dev/null || true
    
    # Start Plandex server if not running
    if ! plandex version >/dev/null 2>&1; then
        echo_info "Starting Plandex server..."
        plandex server start &
        sleep 5
    fi
    
    # Rebuild if needed
    if [ ! -f "./voiceagent" ]; then
        echo_info "Building Voice Plandex..."
        ./manage.sh build
    fi
    
    echo_success "Common issues fixed. Try starting Voice Plandex again."
}

show_logs() {
    echo_header "📋 RECENT LOGS"
    
    if [ -f "/tmp/voiceagent.log" ]; then
        echo_info "Last 20 lines from Voice Plandex logs:"
        tail -20 /tmp/voiceagent.log
    else
        echo_warning "No log file found at /tmp/voiceagent.log"
    fi
}

show_help() {
    echo "Voice Plandex Troubleshooting Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  check     - Run all diagnostic checks"
    echo "  fix       - Attempt to fix common issues"
    echo "  logs      - Show recent logs"
    echo "  help      - Show this help message"
    echo ""
    echo "Individual checks:"
    echo "  cli       - Check Plandex CLI installation"
    echo "  server    - Check Plandex server status"
    echo "  openai    - Check OpenAI API key"
    echo "  voice     - Check Voice Plandex status"
    echo "  ports     - Check port usage"
}

run_all_checks() {
    echo_header "🔍 VOICE PLANDEX DIAGNOSTICS"
    
    check_plandex_cli
    check_plandex_server
    check_openai_api
    check_voice_plandex
    check_ports
    
    echo_header "✅ DIAGNOSTICS COMPLETE"
    echo_info "If issues persist, try: $0 fix"
}

# Main script logic
case "${1:-check}" in
    check)
        run_all_checks
        ;;
    cli)
        check_plandex_cli
        ;;
    server)
        check_plandex_server
        ;;
    openai)
        check_openai_api
        ;;
    voice)
        check_voice_plandex
        ;;
    ports)
        check_ports
        ;;
    fix)
        fix_common_issues
        ;;
    logs)
        show_logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac 