# Multi-stage build for production
FROM public.ecr.aws/docker/library/node:24-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev

# Copy frontend source
COPY frontend/ ./

# Build frontend with production optimizations
ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false
RUN npm run build

# Production stage
FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

# Create non-root user with minimal privileges
RUN groupadd --gid 1000 -r appgroup  && useradd -r --uid 1000 --gid appgroup -d /app appuser

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

# Copy application code
COPY --chown=appuser:appgroup app.py .

# Copy built frontend from builder stage
COPY --chown=appuser:appgroup --from=frontend-builder /app/frontend/build ./frontend/build

# Create writable AWS credentials cache directory with proper permissions
RUN mkdir -p /app/.aws/sso/cache && chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Set production environment variables
ENV FLASK_ENV=production
ENV FLASK_DEBUG=False
ENV PYTHONUNBUFFERED=1

# Run with gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120", "--error-logfile", "-", "--log-level", "info", "app:app"]
