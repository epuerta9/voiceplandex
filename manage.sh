#!/bin/bash

# Voice Plandex Management Script
# Provides easy start/stop/restart/status commands

set -e

BINARY_NAME="voiceagent"
PID_FILE="/tmp/voiceagent.pid"
LOG_FILE="/tmp/voiceagent.log"

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

# Function to get running process info
get_process_info() {
    ps aux | grep "$BINARY_NAME" | grep -v grep | grep -v manage.sh || true
}

# Function to check if service is running
is_running() {
    local proc_info=$(get_process_info)
    [ ! -z "$proc_info" ]
}

# Function to get PID
get_pid() {
    get_process_info | awk '{print $2}' | head -1
}

# Function to start the service
start() {
    echo_info "Starting Voice Plandex..."

    # Check if already running
    if is_running; then
        echo_warning "Voice Plandex is already running (PID: $(get_pid))"
        return 1
    fi

    # Check if binary exists
    if [ ! -f "./$BINARY_NAME" ]; then
        echo_error "Binary '$BINARY_NAME' not found. Run 'go build -o $BINARY_NAME' first."
        return 1
    fi

    # Check environment
    if [ -z "$OPENAI_API_KEY" ]; then
        echo_warning "OPENAI_API_KEY not set. Voice features will not work."
    fi

    # Start the service
    INSECURE=true ADDR=:8000 nohup ./$BINARY_NAME > "$LOG_FILE" 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 2
    if is_running; then
        echo_success "Voice Plandex started successfully (PID: $(get_pid))"
        echo_info "Access at: http://localhost:8000"
        echo_info "Logs: tail -f $LOG_FILE"
    else
        echo_error "Failed to start Voice Plandex. Check logs: $LOG_FILE"
        return 1
    fi
}

# Function to stop the service
stop() {
    echo_info "Stopping Voice Plandex..."

    if ! is_running; then
        echo_warning "Voice Plandex is not running"
        return 1
    fi

    local pid=$(get_pid)
    echo_info "Sending SIGTERM to process $pid..."
    
    # Try graceful shutdown first
    kill -TERM $pid 2>/dev/null || true
    
    # Wait up to 10 seconds for graceful shutdown
    local count=0
    while [ $count -lt 10 ] && is_running; do
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo

    # Force kill if still running
    if is_running; then
        echo_warning "Graceful shutdown failed, force killing..."
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi

    if ! is_running; then
        echo_success "Voice Plandex stopped successfully"
        rm -f "$PID_FILE"
    else
        echo_error "Failed to stop Voice Plandex"
        return 1
    fi
}

# Function to restart the service
restart() {
    echo_info "Restarting Voice Plandex..."
    stop || true
    sleep 2
    start
}

# Function to show status
status() {
    if is_running; then
        local pid=$(get_pid)
        echo_success "Voice Plandex is running (PID: $pid)"
        echo_info "Process info:"
        get_process_info | head -1
        echo_info "Access at: http://localhost:8000"
        echo_info "Logs: tail -f $LOG_FILE"
    else
        echo_warning "Voice Plandex is not running"
    fi
}

# Function to show logs
logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo_error "Log file not found: $LOG_FILE"
    fi
}

# Function to build the binary
build() {
    echo_info "Building Voice Plandex..."
    CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BINARY_NAME"
    echo_success "Build complete: $BINARY_NAME"
}

# Function to show help
help() {
    echo "Voice Plandex Management Script"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|build|help}"
    echo ""
    echo "Commands:"
    echo "  start    - Start Voice Plandex server"
    echo "  stop     - Stop Voice Plandex server" 
    echo "  restart  - Restart Voice Plandex server"
    echo "  status   - Show server status"
    echo "  logs     - Show server logs (follow mode)"
    echo "  build    - Build the binary"
    echo "  help     - Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  OPENAI_API_KEY - Required for voice features"
    echo "  ADDR          - Server address (default: :8000)"
    echo "  INSECURE      - Set to 'true' for HTTP mode"
}

# Main script logic
case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    build)
        build
        ;;
    help|--help|-h)
        help
        ;;
    *)
        echo_error "Unknown command: ${1:-}"
        echo ""
        help
        exit 1
        ;;
esac 