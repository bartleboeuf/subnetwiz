# Multi-stage build for production - Optimized for React artifacts
FROM public.ecr.aws/docker/library/node:24-alpine AS frontend-builder

WORKDIR /app/frontend

# Stage 1: Install dependencies (cached separately for faster rebuilds)
COPY frontend/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Stage 2: Copy source and build (changes to source don't invalidate npm layer)
COPY frontend/src ./src
COPY frontend/public ./public

# Build frontend with production optimizations
# CI=true prevents interactive mode, GENERATE_SOURCEMAP=false reduces build time
# COMPRESS_LEVEL=9 enables maximum compression for static assets
ENV NODE_ENV=production
ENV CI=true
ENV GENERATE_SOURCEMAP=false
ENV REACT_APP_PRODUCTION=true
RUN npm run build

# Optional: Verify build output size
RUN du -sh build/ && ls -lah build/static/js/ && ls -lah build/static/css/

# Production stage
FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

# Create non-root user with minimal privileges
RUN groupadd --gid 1000 -r appgroup && \
    useradd -r --uid 1000 --gid appgroup -d /app appuser && \
    mkdir -p /app/.aws/sso/cache && \
    chown -R appuser:appgroup /app

# Copy requirements and install Python dependencies with caching
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt && \
    pip cache purge

# Copy application code
COPY --chown=appuser:appgroup app.py .

# Copy built frontend from builder stage (optimized artifacts only)
# Note: build/ contains minified JS/CSS with hashed filenames for long-term caching
COPY --chown=appuser:appgroup --from=frontend-builder /app/frontend/build ./frontend/build

# Verify frontend artifacts were copied
RUN ls -lah ./frontend/build/static/ && \
    echo "Frontend build verified - $(find ./frontend/build -type f | wc -l) files total"

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Set production environment variables
ENV FLASK_ENV=production
ENV FLASK_DEBUG=False
ENV PYTHONUNBUFFERED=1

# Health check for orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/health')" || exit 1

# Run with gunicorn for production
# Settings optimized for AWS environment:
# - workers: 4 (suitable for 1-2 CPU, increase for larger instances)
# - worker-class: sync (stable, suitable for I/O-bound Flask)
# - timeout: 120s (for large subnet API calls)
# - access-logfile: disabled (reduce I/O, use CloudWatch instead)
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "4", \
     "--worker-class", "sync", \
     "--timeout", "120", \
     "--keep-alive", "5", \
     "--error-logfile", "-", \
     "--access-logfile", "-", \
     "--log-level", "info", \
     "app:app"]
