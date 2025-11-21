#!/bin/bash
# Generate prisma clients
npx prisma generate

# Start sidecar in background
npx tsx test/integration/sidecar.ts &
SIDECAR_PID=$!

# Ensure sidecar is killed on exit
trap "kill $SIDECAR_PID" EXIT

# Run tests
npx vitest
