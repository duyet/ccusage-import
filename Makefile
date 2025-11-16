.PHONY: help install dev-install test lint format type-check security clean run check docker-up docker-down docs

.DEFAULT_GOAL := help

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install production dependencies
	uv sync --no-dev

dev-install: ## Install all dependencies including dev tools
	uv sync
	uv run pre-commit install

test: ## Run tests with coverage
	uv run pytest tests/ -v --cov=ccusage_import --cov-report=html --cov-report=term-missing

test-quick: ## Run tests without coverage (faster)
	uv run pytest tests/ -v

test-watch: ## Run tests in watch mode
	uv run pytest-watch tests/

bench: ## Run performance benchmarks
	uv run pytest tests/ --benchmark-only

lint: ## Run linting checks
	uv run ruff check .

lint-fix: ## Run linting and auto-fix issues
	uv run ruff check --fix .

format: ## Format code with ruff
	uv run ruff format .

format-check: ## Check code formatting
	uv run ruff format --check .

type-check: ## Run type checking with mypy
	uv run mypy ccusage_import/ ccusage_importer.py --strict --ignore-missing-imports

security: ## Run security checks
	uv run bandit -r ccusage_import/ -f json -o security-report.json || true
	@echo "Security report generated: security-report.json"

safety-check: ## Check for known security vulnerabilities in dependencies
	uv pip list --format=json | uv run safety check --stdin || true

pre-commit: ## Run all pre-commit hooks
	uv run pre-commit run --all-files

clean: ## Clean up generated files
	rm -rf .pytest_cache
	rm -rf .mypy_cache
	rm -rf .ruff_cache
	rm -rf htmlcov
	rm -rf dist
	rm -rf build
	rm -rf *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name '*.pyc' -delete
	find . -type f -name '*.pyo' -delete
	find . -type f -name '.coverage' -delete
	find . -type f -name 'coverage.xml' -delete

run: ## Run the importer
	uv run python ccusage_importer.py

run-check: ## Run system check
	uv run python ccusage_importer.py --check

run-dry: ## Run in dry-run mode (when implemented)
	uv run python ccusage_importer.py --dry-run

docker-up: ## Start local ClickHouse with Docker Compose
	docker-compose up -d

docker-down: ## Stop local ClickHouse
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f

docker-clean: ## Remove Docker volumes (WARNING: deletes data)
	docker-compose down -v

setup-dev: dev-install docker-up ## Complete development environment setup
	@echo "✅ Development environment ready!"
	@echo "📝 Don't forget to copy .env.example to .env and configure it"

ci: lint format-check type-check test security ## Run all CI checks locally

all: clean dev-install ci ## Run everything (clean, install, and all checks)

version: ## Show version
	@uv run python -c "from ccusage_import import __version__; print(__version__)"

.PHONY: help install dev-install test lint format type-check security clean run check docker-up docker-down docs
