#!/bin/bash
# Validation script for Docker Compose setup

set -e

echo "🔍 Validating Docker Compose Setup..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker
echo -n "Checking Docker... "
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}✓${NC} $DOCKER_VERSION"
else
    echo -e "${RED}✗${NC} Docker not found"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Docker Compose
echo -n "Checking Docker Compose... "
if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version)
    echo -e "${GREEN}✓${NC} $COMPOSE_VERSION"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version)
    echo -e "${GREEN}✓${NC} $COMPOSE_VERSION (standalone)"
else
    echo -e "${RED}✗${NC} Docker Compose not found"
    echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check compose file exists
echo -n "Checking docker-compose.local.yml... "
if [ -f "docker-compose.local.yml" ]; then
    echo -e "${GREEN}✓${NC} Found"
else
    echo -e "${RED}✗${NC} Not found"
    exit 1
fi

# Validate compose file syntax
echo -n "Validating compose file syntax... "
if docker compose -f docker-compose.local.yml config > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Valid"
elif command -v docker-compose &> /dev/null && docker-compose -f docker-compose.local.yml config > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Valid"
else
    echo -e "${RED}✗${NC} Invalid syntax"
    exit 1
fi

# Check Dockerfiles exist
echo -n "Checking required Dockerfiles... "
MISSING_FILES=0
for dockerfile in Dockerfile_backend Dockerfile_ui Dockerfile_drift Dockerfile_bg_projects_refresh; do
    if [ ! -f "$dockerfile" ]; then
        echo -e "${RED}✗${NC} Missing: $dockerfile"
        MISSING_FILES=1
    fi
done
if [ $MISSING_FILES -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All present"
fi

# Check for port conflicts
echo ""
echo "🔌 Checking for port conflicts..."
PORTS=(3000 3030 5432)
for port in "${PORTS[@]}"; do
    echo -n "  Port $port... "
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 || netstat -tuln 2>/dev/null | grep -q ":$port "; then
        echo -e "${YELLOW}⚠${NC} In use (may cause conflicts)"
    else
        echo -e "${GREEN}✓${NC} Available"
    fi
done

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Validation Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Ready to start? Run one of these commands:"
echo ""
echo "  make -f Makefile.docker up"
echo "  docker compose -f docker-compose.local.yml up"
echo ""
echo "📚 See QUICK_START_SUMMARY.md for more info"
echo ""
