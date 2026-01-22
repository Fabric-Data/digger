# 🚀 Quick Start - Digger Local Development with Docker

**TL;DR**: Get Digger running locally in 3 commands:

```bash
# Option 1: Using Make (easiest)
make -f Makefile.docker up

# Option 2: Using Docker Compose directly
docker-compose -f docker-compose.local.yml up

# Access the UI at http://localhost:3030
```

---

## 📋 What Was Created

I've set up a complete Docker Compose environment for quick local testing:

### Files Created:

1. **`docker-compose.local.yml`** - Main compose file with all services
2. **`DOCKER_QUICKSTART.md`** - Detailed documentation
3. **`.env.local.example`** - Environment variable template
4. **`Makefile.docker`** - Convenient make commands

### Services Included:

| Service | Port | Description | Auto-Start |
|---------|------|-------------|------------|
| **PostgreSQL** | 5432 | Database | ✅ Yes |
| **Backend** | 3000 | Go API server | ✅ Yes |
| **UI** | 3030 | React frontend | ✅ Yes |
| **Drift** | 3001 | Drift detection | ⚙️ Optional (--profile full) |
| **Projects Refresh** | - | Background jobs | ⚙️ Optional (--profile full) |

---

## 🎯 Quickest Way to Start

### Using Make (Recommended):

```bash
# See all available commands
make -f Makefile.docker help

# Start core services
make -f Makefile.docker up

# Start all services (including optional)
make -f Makefile.docker up-full

# View logs
make -f Makefile.docker logs

# Stop everything
make -f Makefile.docker down
```

### Using Docker Compose Directly:

```bash
# Start (core services)
docker-compose -f docker-compose.local.yml up -d

# Start (all services)
docker-compose -f docker-compose.local.yml --profile full up -d

# View logs
docker-compose -f docker-compose.local.yml logs -f

# Stop
docker-compose -f docker-compose.local.yml down
```

---

## 🔍 Access Points

Once running, access these URLs:

- **Web UI**: http://localhost:3030
- **Backend API**: http://localhost:3000
- **PostgreSQL**: `localhost:5432` (user: `postgres`, pass: `postgres`, db: `digger`)
- **Drift Service** (if running full profile): http://localhost:3001

---

## 🛠️ Common Tasks

### View Logs:
```bash
make -f Makefile.docker logs          # All services
make -f Makefile.docker logs-backend  # Just backend
make -f Makefile.docker logs-ui       # Just UI
```

### Rebuild After Code Changes:
```bash
make -f Makefile.docker rebuild
# or
docker-compose -f docker-compose.local.yml up --build
```

### Access Container Shell:
```bash
make -f Makefile.docker shell-backend   # Backend bash shell
make -f Makefile.docker shell-postgres  # PostgreSQL psql
make -f Makefile.docker shell-ui        # UI shell
```

### Fresh Start (Clean Slate):
```bash
make -f Makefile.docker clean
# or
docker-compose -f docker-compose.local.yml down -v
```

---

## 📊 Architecture

```
┌────────────────────────────────────────────────┐
│             http://localhost:3030              │
│                                                │
│              UI (React/Node)                   │
└───────────────────┬────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│             http://localhost:3000              │
│                                                │
│          Backend (Go/Gin API)                  │
└───────────────────┬────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│              localhost:5432                    │
│                                                │
│         PostgreSQL Database                    │
│    (user: postgres, pass: postgres)            │
└────────────────────────────────────────────────┘

        Optional Services (--profile full):
┌────────────────────────────────────────────────┐
│  Drift Detection (3001) | Projects Refresh     │
└────────────────────────────────────────────────┘
```

---

## ⚙️ Configuration

### Default Settings (No Config Required)

The setup works out-of-the-box with sensible defaults:
- PostgreSQL credentials: `postgres/postgres`
- Database: `digger`
- All services networked together
- Auto migrations on backend startup

### Custom Configuration (Optional)

If you need to customize:

1. Copy the example env file:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` with your settings

3. Update `docker-compose.local.yml` to use it:
   ```yaml
   services:
     backend:
       env_file:
         - .env.local
   ```

---

## 🔧 Troubleshooting

### Port Already in Use?

If ports 3000, 3030, or 5432 are taken, edit `docker-compose.local.yml`:

```yaml
ports:
  - "3100:3000"  # Changed from 3000
```

### Database Connection Failed?

```bash
# Check PostgreSQL health
docker-compose -f docker-compose.local.yml ps postgres

# View logs
docker-compose -f docker-compose.local.yml logs postgres
```

### Services Won't Start?

```bash
# Clean rebuild
make -f Makefile.docker clean
make -f Makefile.docker build
make -f Makefile.docker up
```

---

## 📝 Next Steps

1. **Test the Setup**: Open http://localhost:3030 in your browser
2. **Read Full Docs**: See `DOCKER_QUICKSTART.md` for detailed info
3. **Development**: Make code changes and rebuild with `make -f Makefile.docker rebuild`
4. **Production**: See [official docs](https://docs.digger.dev/) for production deployments

---

## ⚠️ Important Notes

- **Local Development Only**: This setup uses weak passwords and is NOT production-ready
- **Data Persistence**: PostgreSQL data persists in a Docker volume
- **Clean Slate**: Run `make -f Makefile.docker clean` to wipe all data
- **Auto Migrations**: Backend runs database migrations on startup

---

## 📚 Additional Resources

- **Detailed Guide**: [DOCKER_QUICKSTART.md](DOCKER_QUICKSTART.md)
- **Environment Variables**: [.env.local.example](.env.local.example)
- **Main Docs**: https://docs.digger.dev/
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 🎉 That's It!

You now have a fully functional Digger development environment running locally. Happy testing! 🚀

For questions or issues, check the [Digger Community Slack](https://bit.ly/diggercommunity).
