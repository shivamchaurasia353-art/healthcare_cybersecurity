#!/bin/bash
# HealthSecure — Start all services
# Usage: ./start.sh [up|down|restart|logs|status|reset]

set -e
COMPOSE_CMD="/Library/Frameworks/Python.framework/Versions/3.12/bin/podman-compose"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR"

# Load .env and export every variable (no :-default needed in compose file)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

ACTION="${1:-up}"

case "$ACTION" in
  up)
    echo "🚀 Starting HealthSecure..."

    # Pre-create named volumes (workaround for podman-compose label bug)
    podman volume create healthcare_cybersecurity_sqlite_data 2>/dev/null || true
    podman volume create healthcare_cybersecurity_backend_logs 2>/dev/null || true

    $COMPOSE_CMD up -d --build

    echo ""
    echo "✅ All services started:"
    echo "   🌐 Patient App      → http://localhost:3000"
    echo "   🔌 Backend API      → http://localhost:5000"
    echo "   🏥 Vendor Demo      → http://localhost:5001  ← use this URL (not file://)"
    echo "   🗄  SQLite DB        → /app/data/healthsecure.db (inside backend container)"
    echo ""
    echo "Demo credentials (after running seed):"
    echo "   Email    : demo@healthsecure.test"
    echo "   Password : Demo@1234"
    echo ""
    if [ -f "$PROJECT_DIR/.vendor-keys" ]; then
      echo "$(cat "$PROJECT_DIR/.vendor-keys" | grep -v '^#' | grep -v '^$')"
    else
      echo "⚠️  No vendor keys found. Seeding demo data..."
      sleep 3
      podman exec -e SQLITE_PATH=/app/data/healthsecure.db healthsecure_api node /app/scripts/seed.js
      podman cp healthsecure_api:/app/data/.vendor-keys "$PROJECT_DIR/.vendor-keys" 2>/dev/null || true
    fi
    ;;

  down)
    echo "🛑 Stopping HealthSecure..."
    $COMPOSE_CMD down
    ;;

  restart)
    echo "🔄 Restarting HealthSecure..."
    $0 down
    $0 up
    ;;

  reset)
    echo "⚠️  Resetting HealthSecure (wipes database)..."
    $COMPOSE_CMD down 2>/dev/null || true
    podman volume rm healthcare_cybersecurity_sqlite_data 2>/dev/null || true
    podman volume rm healthcare_cybersecurity_backend_logs 2>/dev/null || true
    $0 up
    echo ""
    echo "📦 Seeding demo data..."
    sleep 3
    podman exec -e SQLITE_PATH=/app/data/healthsecure.db healthsecure_api node /app/scripts/seed.js
    podman cp healthsecure_api:/app/data/.vendor-keys "$PROJECT_DIR/.vendor-keys" 2>/dev/null || true
    ;;

  logs)
    SERVICE="${2:-backend}"
    $COMPOSE_CMD logs -f "$SERVICE"
    ;;

  status)
    podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep healthsecure
    ;;

  *)
    echo "Usage: $0 [up|down|restart|reset|logs [service]|status]"
    exit 1
    ;;
esac
