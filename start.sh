#!/bin/bash

# X-Agent Start Script

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  🚀 X-Agent Starting Services${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}\n"

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}[CONFIG] No .env file found. Creating from template...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}[CONFIG] Created .env file. Please add your API keys.${NC}"
    else
        echo -e "${RED}[CONFIG] No .env.example found!${NC}"
        exit 1
    fi
fi

# Load environment variables
set -a
source .env
set +a

# Function to kill processes on ports
kill_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}[CLEANUP] Stopping process on port $port...${NC}"
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Clean up any existing processes
echo -e "${BLUE}[CLEANUP] Checking for existing processes...${NC}"
kill_port 3001  # Backend
kill_port 1122  # Frontend

# Install backend dependencies if needed
if [ ! -d "backend/node_modules" ]; then
    echo -e "${BLUE}[BACKEND] Installing dependencies...${NC}"
    cd backend
    npm install

    # Generate Prisma client
    echo -e "${BLUE}[DATABASE] Generating Prisma client...${NC}"
    cd backend && npm run db:generate && cd ..

    # Push database schema
    echo -e "${BLUE}[DATABASE] Initializing database...${NC}"
    cd backend && npm run db:push && cd ..

    cd ..
fi

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${BLUE}[FRONTEND] Installing dependencies...${NC}"
    cd frontend
    npm install
    cd ..
fi

# Create logs directory
mkdir -p logs

# Start backend
echo -e "${GREEN}[BACKEND] Starting backend server on port 3001...${NC}"
cd backend
npm start > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
echo -e "${BLUE}[BACKEND] Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3001/health >/dev/null 2>&1; then
        echo -e "${GREEN}[BACKEND] ✅ Backend is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Start frontend
echo -e "${GREEN}[FRONTEND] Starting frontend on port 1122...${NC}"
cd frontend
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to start
echo -e "${BLUE}[FRONTEND] Waiting for frontend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:1122 >/dev/null 2>&1; then
        echo -e "${GREEN}[FRONTEND] ✅ Frontend is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Save PIDs for stop script
echo "$BACKEND_PID" > .backend.pid
echo "$FRONTEND_PID" > .frontend.pid

# Display status
echo -e "\n${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ X-Agent is running!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}\n"

echo -e "Services:"
echo -e "  Frontend:   ${BLUE}http://localhost:1122${NC}"
echo -e "  Backend:    ${BLUE}http://localhost:3001${NC}"
echo -e "  Health:     ${BLUE}http://localhost:3001/health${NC}"

echo -e "\nProcesses:"
echo -e "  Backend PID:  $BACKEND_PID"
echo -e "  Frontend PID: $FRONTEND_PID"

echo -e "\nLogs:"
echo -e "  Backend:  ${YELLOW}tail -f logs/backend.log${NC}"
echo -e "  Frontend: ${YELLOW}tail -f logs/frontend.log${NC}"

echo -e "\nCommands:"
echo -e "  Collect tweets:  ${BLUE}cd backend && npm run collect @username${NC}"
echo -e "  Stop services:   ${BLUE}./stop.sh${NC}"

# Check API configuration
echo -e "\n${BLUE}[STATUS] Configuration:${NC}"
if grep -q "X_COM_BEARER_TOKEN=your" .env 2>/dev/null; then
    echo -e "  ${YELLOW}⚠️  X.com API not configured (add X_COM_BEARER_TOKEN to .env)${NC}"
else
    echo -e "  ${GREEN}✅ X.com API configured${NC}"
fi

if grep -q "XAI_API_KEY=your" .env 2>/dev/null; then
    echo -e "  ${YELLOW}⚠️  Grok API not configured (add XAI_API_KEY to .env)${NC}"
else
    echo -e "  ${GREEN}✅ Grok API configured${NC}"
fi

echo -e "\n${GREEN}[READY] X-Agent is ready for use!${NC}"
echo -e "${BLUE}[INFO] Press Ctrl+C to return to terminal (services keep running)${NC}"

# Keep script running to show logs
trap 'echo -e "\n${BLUE}[INFO] Services still running. Use ./stop.sh to stop them.${NC}"; exit 0' INT

# Follow backend logs
tail -f logs/backend.log
