.PHONY: help dev-server dev-client build-server build-client deploy-server deploy-client deploy-server-preview deploy-client-preview test-server-e2e db-start db-stop db-reset prisma-generate lint lint-fix format format-fix check-style fix-style

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'

dev-server: prisma-generate ## Start the server in development mode
	pnpm --filter toiletmap-server build:client
	pnpm --filter toiletmap-server dev

dev-client: ## Start the client in development mode
	pnpm --filter toiletmap-client dev

build-server: ## Build the server
	pnpm --filter toiletmap-server build

build-client: ## Build the client
	pnpm --filter toiletmap-client build

deploy-server: ## Deploy the server to production
	pnpm --filter toiletmap-server run deploy

deploy-client: ## Deploy the client to production
	pnpm --filter toiletmap-client run deploy

deploy-server-preview: ## Deploy the server to preview environment
	pnpm --filter toiletmap-server run deploy:preview

deploy-client-preview: ## Deploy the client to preview environment
	pnpm --filter toiletmap-client run deploy:preview

test-server-e2e: ## Run end-to-end tests for the server
	pnpm --filter toiletmap-server test:e2e

db-start: ## Start the local Supabase database
	pnpm --filter toiletmap-server supabase:start

db-stop: ## Stop the local Supabase database
	pnpm --filter toiletmap-server supabase:stop

db-reset: ## Reset the local Supabase database
	pnpm --filter toiletmap-server supabase:reset

prisma-generate: ## Generate Prisma client
	pnpm --filter toiletmap-server prisma:generate

lint: ## Run Biome linter check
	pnpm lint

lint-fix: ## Run Biome linter with auto-fix
	pnpm lint:fix

format: ## Run Biome formatter check
	pnpm format

format-fix: ## Run Biome formatter with auto-fix
	pnpm format:fix

check-style: ## Run Biome checks (lint + format)
	pnpm check

fix-style: ## Run Biome fixes (lint + format)
	pnpm check:fix

check: check-style ## Run style check, typecheck, and dry-run deployment
	pnpm --filter toiletmap-server check

cf-typegen: ## Generate Cloudflare Worker types
	pnpm --filter toiletmap-server cf-typegen
	pnpm --filter toiletmap-client cf-typegen

token-issue: ## Issue a test token
	pnpm --filter toiletmap-server token:issue
