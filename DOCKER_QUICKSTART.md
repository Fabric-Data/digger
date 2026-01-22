# Docker Compose Quick Start Guide

This guide helps you quickly spin up Digger services locally for testing using Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+
- At least 4GB of available RAM

## Quick Start

### 1. Start Core Services (Recommended for Quick Tests)

Start just the essential services (PostgreSQL, Backend, UI):

```bash
docker-compose -f docker-compose.local.yml up
```

Or run in detached mode:

```bash
docker-compose -f docker-compose.local.yml up -d
```

**Services started:**
- PostgreSQL: `localhost:5432`
- Backend API: `http://localhost:3000`
- UI: `http://localhost:3030`

### 2. Start All Services (Full Stack)

To include optional services like drift detection and background jobs:

```bash
docker-compose -f docker-compose.local.yml --profile full up
```

**Additional services:**
- Drift Detection: `http://localhost:3001`
- Background Projects Refresh Service

### 3. Access the Services

- **Web UI**: Open [http://localhost:3030](http://localhost:3030)
- **Backend API**: [http://localhost:3000](http://localhost:3000)
- **PostgreSQL**: `localhost:5432` (user: `postgres`, password: `postgres`, db: `digger`)

## Common Commands

### View Logs

```bash
# All services
docker-compose -f docker-compose.local.yml logs -f

# Specific service
docker-compose -f docker-compose.local.yml logs -f backend
docker-compose -f docker-compose.local.yml logs -f ui
```

### Stop Services

```bash
docker-compose -f docker-compose.local.yml down
```

### Stop and Remove Volumes (Clean Slate)

```bash
docker-compose -f docker-compose.local.yml down -v
```

### Rebuild Services

If you've made code changes:

```bash
# Rebuild specific service
docker-compose -f docker-compose.local.yml build backend

# Rebuild all and restart
docker-compose -f docker-compose.local.yml up --build
```

### Check Service Status

```bash
docker-compose -f docker-compose.local.yml ps
```

### Execute Commands in Running Container

```bash
# Access backend shell
docker-compose -f docker-compose.local.yml exec backend bash

# Access PostgreSQL
docker-compose -f docker-compose.local.yml exec postgres psql -U postgres -d digger
```

## Environment Configuration

The compose file uses sensible defaults for local development. To customize:

1. Copy the example env file:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` with your settings

3. Update `docker-compose.local.yml` to use your env file:
   ```yaml
   services:
     backend:
       env_file:
         - .env.local
   ```

## Troubleshooting

### Database Connection Issues

If the backend fails to connect to PostgreSQL:

```bash
# Check if PostgreSQL is healthy
docker-compose -f docker-compose.local.yml ps postgres

# View PostgreSQL logs
docker-compose -f docker-compose.local.yml logs postgres
```

### Port Conflicts

If ports 3000, 3030, or 5432 are already in use, modify the port mappings in `docker-compose.local.yml`:

```yaml
ports:
  - "3100:3000"  # Changed from 3000:3000
```

### Rebuild from Scratch

```bash
# Stop everything
docker-compose -f docker-compose.local.yml down -v

# Remove images
docker-compose -f docker-compose.local.yml down --rmi all

# Rebuild and start
docker-compose -f docker-compose.local.yml up --build
```

### Migration Issues

If you see database migration errors:

```bash
# Access backend container
docker-compose -f docker-compose.local.yml exec backend bash

# Run migrations manually
cd /app
atlas migrate apply --url $DATABASE_URL --allow-dirty
```

## Development Workflow

### Make Code Changes

1. Make your code changes locally
2. Rebuild the affected service:
   ```bash
   docker-compose -f docker-compose.local.yml up --build backend
   ```

### Test API Endpoints

```bash
# Health check
curl http://localhost:3000/

# Using from another container
docker-compose -f docker-compose.local.yml exec backend curl http://backend:3000/
```

## Architecture

```
┌─────────────────┐
│   UI (3030)     │
│   Node.js       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  Backend (3000) │────▶│  PostgreSQL      │
│  Go/Gin API     │     │  (5432)          │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│  Drift (3001)   │
│  Optional       │
└─────────────────┘
```

## Production Considerations

⚠️ **This setup is for LOCAL DEVELOPMENT ONLY**

For production deployments:
- Use strong passwords (not `postgres`)
- Enable SSL for database connections
- Use proper secrets management
- Configure proper authentication
- Use production-ready images from registry
- See the main [docs](https://docs.digger.dev/) for production deployment guides

## Further Reading

- [Digger Documentation](https://docs.digger.dev/)
- [Contributing Guide](CONTRIBUTING.md)
- [GitHub Actions Setup](https://docs.digger.dev/getting-started/github-actions-+-aws)
