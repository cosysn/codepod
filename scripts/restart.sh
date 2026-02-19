#!/bin/bash
# Restart Docker services without rebuilding

cd "$(dirname "$0")/../docker"

echo "Restarting Docker services..."
docker-compose down
docker-compose up -d

echo "Waiting for services..."
sleep 5

echo ""
echo "Status:"
docker-compose ps
