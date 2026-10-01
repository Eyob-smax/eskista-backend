#!/bin/bash
set -euo pipefail

# ── Eskista Backend — VPS Deployment Script ────────────────────────────────
# Usage:
#   First deploy:  ./deploy.sh setup
#   Update code:   ./deploy.sh deploy
#   View logs:     ./deploy.sh logs
#   SSL setup:     ./deploy.sh ssl your-domain.com your@email.com

APP_DIR="/var/www/eskista-backend"
REPO_URL="https://github.com/Eyob-smax/eskista-backend.git"
BRANCH="main"
COMPOSE_FILE="docker-compose.prod.yml"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ESKISTA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# ── Prerequisites ───────────────────────────────────────────────────────────
check_deps() {
    log "Checking dependencies..."
    for cmd in docker git; do
        command -v "$cmd" >/dev/null 2>&1 || err "$cmd is not installed"
    done

    # Check docker compose (v2 plugin)
    docker compose version >/dev/null 2>&1 || err "docker compose plugin is not installed"

    log "All dependencies found ✓"
}

# ── Install Docker (if needed) ──────────────────────────────────────────────
install_docker() {
    if command -v docker &>/dev/null; then
        log "Docker already installed"
        return
    fi

    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker installed ✓"
}

# ── First-time setup ───────────────────────────────────────────────────────
setup() {
    log "Running first-time setup..."

    install_docker
    check_deps

    # Clone repo
    if [ ! -d "$APP_DIR" ]; then
        log "Cloning repository..."
        git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
    else
        warn "$APP_DIR already exists, pulling latest..."
        cd "$APP_DIR"
        git pull origin "$BRANCH"
    fi

    cd "$APP_DIR"

    # Create .env if it doesn't exist
    if [ ! -f .env ]; then
        cp .env.example .env
        warn "Created .env from .env.example — EDIT IT before deploying!"
        warn "  nano $APP_DIR/.env"
        warn ""
        warn "Required changes:"
        warn "  - POSTGRES_PASSWORD  → strong random password"
        warn "  - BETTER_AUTH_SECRET → openssl rand -base64 48"
        warn "  - TELEGRAM_BOT_TOKEN → from @BotFather"
        warn "  - CORS_ORIGINS → your frontend URL"
        warn "  - Cloudinary credentials (if using cloud storage)"
        echo ""
        log "After editing .env, run: ./deploy.sh deploy"
        return
    fi

    deploy
}

# ── Deploy / Update ─────────────────────────────────────────────────────────
deploy() {
    cd "$APP_DIR"
    check_deps

    log "Pulling latest code..."
    git pull origin "$BRANCH"

    log "Building and starting containers..."
    docker compose -f "$COMPOSE_FILE" build --no-cache api
    docker compose -f "$COMPOSE_FILE" up -d

    log "Waiting for database to be ready..."
    sleep 5

    log "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" exec api npx prisma migrate deploy

    log "Deployment complete ✓"
    echo ""
    docker compose -f "$COMPOSE_FILE" ps
}

# ── SSL Setup with Let's Encrypt ────────────────────────────────────────────
ssl() {
    local domain="${1:-}"
    local email="${2:-}"

    [ -z "$domain" ] && err "Usage: ./deploy.sh ssl <domain> <email>"
    [ -z "$email" ] && err "Usage: ./deploy.sh ssl <domain> <email>"

    cd "$APP_DIR"

    log "Obtaining SSL certificate for $domain..."

    # Run certbot to get initial certificate
    docker compose -f "$COMPOSE_FILE" run --rm certbot \
        certbot certonly --webroot \
        --webroot-path /var/www/certbot \
        --email "$email" \
        --agree-tos --no-eff-email \
        -d "$domain"

    # Update nginx config: uncomment HTTPS block and replace domain
    log "Updating nginx config..."
    sed -i "s/YOUR_DOMAIN/$domain/g" nginx/conf.d/default.conf
    sed -i '/^# server {/,/^# }/ s/^# //' nginx/conf.d/default.conf

    # Comment out the temporary HTTP proxy
    sed -i '/Temporary: HTTP proxy/,/^}/ s/^/# /' nginx/conf.d/default.conf

    # Reload nginx
    docker compose -f "$COMPOSE_FILE" exec nginx nginx -s reload

    log "SSL configured for $domain ✓"
}

# ── Logs ────────────────────────────────────────────────────────────────────
logs() {
    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" logs -f "${1:-api}"
}

# ── Status ──────────────────────────────────────────────────────────────────
status() {
    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" ps
}

# ── Rollback ────────────────────────────────────────────────────────────────
rollback() {
    cd "$APP_DIR"
    log "Rolling back to previous commit..."
    git checkout HEAD~1
    docker compose -f "$COMPOSE_FILE" build --no-cache api
    docker compose -f "$COMPOSE_FILE" up -d api
    log "Rolled back ✓"
}

# ── Backup Database ────────────────────────────────────────────────────────
backup() {
    cd "$APP_DIR"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="backups/eskista_${timestamp}.sql.gz"

    mkdir -p backups
    log "Backing up database to $backup_file ..."

    docker compose -f "$COMPOSE_FILE" exec -T postgres \
        pg_dump -U "${POSTGRES_USER:-eskista}" "${POSTGRES_DB:-eskista}" \
        | gzip > "$backup_file"

    log "Backup saved: $backup_file ✓"
}

# ── Main ────────────────────────────────────────────────────────────────────
case "${1:-help}" in
    setup)    setup ;;
    deploy)   deploy ;;
    ssl)      ssl "${2:-}" "${3:-}" ;;
    logs)     logs "${2:-}" ;;
    status)   status ;;
    rollback) rollback ;;
    backup)   backup ;;
    *)
        echo "Eskista Backend — VPS Deployment"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  setup              First-time server setup (installs Docker, clones repo)"
        echo "  deploy             Pull latest code and redeploy"
        echo "  ssl <domain> <email>  Set up SSL with Let's Encrypt"
        echo "  logs [service]     Stream logs (default: api)"
        echo "  status             Show container status"
        echo "  rollback           Roll back to previous commit"
        echo "  backup             Backup the database"
        ;;
esac
