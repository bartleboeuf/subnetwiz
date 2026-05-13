#!/bin/bash
# Helper script to update frontend dependencies using Docker

set -e

DOCKER_IMAGE="frontend-deps-updater"
CMD="${1:-help}"

# Build the Docker image
build_image() {
  echo "📦 Building Docker image for dependency management..."
  docker build -f Dockerfile-DepsUpdate -t "$DOCKER_IMAGE" .
}

# Show outdated packages
show_outdated() {
  echo "🔍 Checking for outdated packages..."
  docker run --rm -v "$(pwd)/frontend:/app/frontend" "$DOCKER_IMAGE" npm outdated
}

# Update all dependencies (minor and patch versions)
update_deps() {
  echo "📡 Updating dependencies to latest minor/patch versions..."
  docker run --rm -v "$(pwd)/frontend:/app/frontend" "$DOCKER_IMAGE" npm update
}

# Update all dependencies (including major versions)
update_deps_major() {
  echo "⚠️  Updating dependencies to latest versions (including major)..."
  docker run --rm -v "$(pwd)/frontend:/app/frontend" "$DOCKER_IMAGE" sh -c "npm install -g npm-check-updates && ncu -u && npm install"
}

# Audit and fix vulnerabilities
audit_fix() {
  echo "🔒 Running security audit and fix..."
  docker run --rm -v "$(pwd)/frontend:/app/frontend" "$DOCKER_IMAGE" npm audit fix
}

# Interactive shell
shell() {
  echo "🐚 Starting interactive shell in container..."
  docker run --rm -it -v "$(pwd)/frontend:/app/frontend" "$DOCKER_IMAGE" sh
}

# Show help
show_help() {
  cat << EOF
📚 Frontend Dependency Update Helper

Usage: ./scripts/update-deps.sh [command]

Commands:
  build         Build the Docker image
  outdated      Check for outdated packages
  update        Update packages (minor/patch versions)
  major         Update packages (including major versions)
  audit-fix     Run security audit and fix vulnerabilities
  shell         Start interactive shell in container
  help          Show this help message (default)

Examples:
  ./scripts/update-deps.sh build
  ./scripts/update-deps.sh outdated
  ./scripts/update-deps.sh update
  ./scripts/update-deps.sh audit-fix

EOF
}

case "$CMD" in
  build)
    build_image
    ;;
  outdated)
    build_image
    show_outdated
    ;;
  update)
    build_image
    update_deps
    ;;
  major)
    build_image
    update_deps_major
    ;;
  audit-fix)
    build_image
    audit_fix
    ;;
  shell)
    build_image
    shell
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    echo "❌ Unknown command: $CMD"
    show_help
    exit 1
    ;;
esac
