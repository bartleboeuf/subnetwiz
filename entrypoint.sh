#!/bin/bash
set -e

# SubnetViz startup script
echo "=========================================="
echo "SubnetViz - AWS Subnet Visualization Tool"
echo "Version: 1.1.0"
echo "=========================================="
echo ""
echo "Starting SubnetViz service..."
echo "=========================================="
echo ""

# Execute gunicorn with all passed arguments
exec "$@"
