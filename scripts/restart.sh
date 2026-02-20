#!/bin/bash
# Restart Docker services without rebuilding

cd "$(dirname "$0")/../docker"

echo "Restarting Docker services..."

# Remove any leftover sandbox containers
docker ps -a --filter "name=sbox-" -q | xargs -r docker rm -f 2>/dev/null || true

docker-compose down
docker-compose up -d

echo "Waiting for services..."
sleep 5

echo ""
echo "Status:"
docker-compose ps

echo ""
echo "Health Check:"
curl -s http://localhost:8080/health || echo "Server not responding"
