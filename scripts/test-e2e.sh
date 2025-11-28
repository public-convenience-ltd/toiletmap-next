#!/bin/bash
# Generate prisma clients
npx prisma generate

# Run tests
npx vitest
