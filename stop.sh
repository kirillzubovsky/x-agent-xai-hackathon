#!/bin/bash

# X-Agent Stop Script

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  ⏹️  X-Agent Stopping Services${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}\n"

# Function to kill process by PID
kill_pid() {
    local pid=$1
    local name=$2
    if [ -n "$pid" ] && kill -0 $pid 2>/dev/null; then
        echo -e "${YELLOW}[STOP] Stopping $name (PID: $pid)...${NC}"
        kill $pid 2>/dev/null
        sleep 1
        # Force kill if still running
        if kill -0 $pid 2>/dev/null; then
            kill -9 $pid 2>/dev/null
        fi
        echo -e "${GREEN}[STOP] ✅ $name stopped${NC}"
    else
        echo -e "${BLUE}[STOP] $name not running${NC}"
    fi
}

# Function to kill processes on ports
kill_port() {
    local port=$1
    local name=$2
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}[CLEANUP] Stopping $name on port $port...${NC}"
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
        sleep 1
        echo -e "${GREEN}[CLEANUP] ✅ Port $port cleared${NC}"
    else
        echo -e "${BLUE}[CLEANUP] Port $port already clear${NC}"
    fi
}

# Stop services using saved PIDs
if [ -f ".backend.pid" ]; then
    BACKEND_PID=$(cat .backend.pid)
    kill_pid "$BACKEND_PID" "Backend"
    rm -f .backend.pid
else
    echo -e "${BLUE}[STOP] No backend PID file found${NC}"
fi

if [ -f ".frontend.pid" ]; then
    FRONTEND_PID=$(cat .frontend.pid)
    kill_pid "$FRONTEND_PID" "Frontend"
    rm -f .frontend.pid
else
    echo -e "${BLUE}[STOP] No frontend PID file found${NC}"
fi

# Clean up any remaining processes on ports
echo -e "\n${BLUE}[CLEANUP] Checking for remaining processes...${NC}"
kill_port 3001 "Backend"
kill_port 1122 "Frontend"

# Check for any node processes related to x-agent
echo -e "\n${BLUE}[CLEANUP] Checking for related processes...${NC}"
REMAINING=$(ps aux | grep -E "x-agent.*node" | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo -e "${YELLOW}[CLEANUP] Found $REMAINING related processes${NC}"
    ps aux | grep -E "x-agent.*node" | grep -v grep
else
    echo -e "${GREEN}[CLEANUP] ✅ No remaining processes${NC}"
fi

# Final verification
echo -e "\n${BLUE}[VERIFY] Final port check...${NC}"
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1 || lsof -Pi :1122 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}[VERIFY] ⚠️  Some ports may still be in use${NC}"
else
    echo -e "${GREEN}[VERIFY] ✅ All ports are clear${NC}"
fi

echo -e "\n${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ X-Agent stopped successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}\n"

echo -e "To start again: ${BLUE}./start.sh${NC}"
