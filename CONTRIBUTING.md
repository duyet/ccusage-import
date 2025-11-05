# Contributing to ccusage-import

Thank you for your interest in contributing to ccusage-import! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project follows a standard code of conduct. Please be respectful and constructive in all interactions.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ccusage-import.git
   cd ccusage-import
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/duyet/ccusage-import.git
   ```

## Development Setup

### Prerequisites

- Python 3.8 or higher
- [uv](https://github.com/astral-sh/uv) package manager
- Node.js (for ccusage CLI)
- ClickHouse server (for integration testing)

### Install Dependencies

```bash
# Install Python dependencies
uv sync

# Install ccusage CLI
npm install -g ccusage
# OR use npx
npx ccusage@latest --help
```

### Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your ClickHouse credentials
vi .env
```

## Making Changes

### Branch Naming Convention

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `test/description` - Test additions or modifications
- `refactor/description` - Code refactoring

### Workflow

1. Create a new branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes following the code style guidelines

3. Add tests for new functionality

4. Run the test suite to ensure everything passes

5. Commit your changes with clear, descriptive messages

## Testing

### Run All Tests

```bash
# Run full test suite with coverage
uv run pytest tests/ -v --cov=. --cov-report=term-missing

# Run specific test file
uv run pytest tests/test_ccusage_importer.py -v

# Run specific test
uv run pytest tests/test_ccusage_importer.py::TestClickHouseImporter::test_import_daily_data -v
```

### Test Coverage

We aim for at least 90% test coverage. Please ensure your changes include appropriate tests.

```bash
# Generate coverage report
uv run pytest tests/ --cov=. --cov-report=html
```

### System Check

Before submitting, run the system check to ensure everything is configured correctly:

```bash
uv run python ccusage_importer.py --check
```

## Code Style

### Python Code Standards

We use the following tools for code quality:

- **Ruff** - Fast Python linter and formatter
- **MyPy** - Static type checking

### Format Code

```bash
# Format code with ruff
uv run ruff format .

# Check formatting without applying changes
uv run ruff format --check .
```

### Lint Code

```bash
# Run linter
uv run ruff check .

# Auto-fix issues
uv run ruff check --fix .

# Include unsafe fixes
uv run ruff check --fix --unsafe-fixes .
```

### Type Checking

```bash
# Run type checker
uv run mypy ccusage_importer.py --ignore-missing-imports
```

### Code Style Guidelines

- Use type hints for function parameters and return values
- Use f-strings for string formatting (avoid nested quotes)
- Handle errors gracefully with try/except blocks
- Use meaningful variable names and function docstrings
- Follow PEP 8 style guidelines
- Maximum line length: 88 characters (ruff default)

### Example Code Style

```python
def import_data(date: str, retry: int = 3) -> Dict[str, Any]:
    """
    Import data for a specific date.

    Args:
        date: Date string in YYYY-MM-DD format
        retry: Number of retry attempts (default: 3)

    Returns:
        Dictionary containing import results

    Raises:
        ValueError: If date format is invalid
    """
    try:
        # Implementation
        result = {"status": "success", "records": 42}
        return result
    except Exception as e:
        raise ValueError(f"Import failed: {e}")
```

## Submitting Changes

### Before Submitting

1. Ensure all tests pass:
   ```bash
   uv run pytest tests/ -v
   ```

2. Check code style:
   ```bash
   uv run ruff check .
   uv run ruff format --check .
   ```

3. Run type checker:
   ```bash
   uv run mypy ccusage_importer.py --ignore-missing-imports
   ```

4. Update documentation if needed

### Pull Request Process

1. Push your branch to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```

2. Create a Pull Request on GitHub with:
   - Clear title describing the change
   - Detailed description of what changed and why
   - Reference any related issues
   - Screenshots if applicable (for UI changes)

3. Address review comments if any

4. Once approved, your PR will be merged

### Commit Message Guidelines

Write clear, descriptive commit messages:

```
feat: add support for custom machine names

- Add MACHINE_NAME environment variable
- Update documentation with configuration examples
- Add tests for custom machine name functionality
```

Prefix types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test additions/changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

1. **Description**: Clear description of the bug
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Environment**:
   - OS and version
   - Python version
   - ClickHouse version
   - ccusage version
6. **Logs**: Relevant error messages or logs
7. **Screenshots**: If applicable

### Feature Requests

When requesting features, please include:

1. **Use Case**: Describe the problem you're trying to solve
2. **Proposed Solution**: Your suggested approach
3. **Alternatives**: Other solutions you've considered
4. **Additional Context**: Any other relevant information

### Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

## Development Tips

### Debugging

Enable verbose output for debugging:

```python
# In ccusage_importer.py
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Testing with Mock Data

```python
from unittest.mock import patch, MagicMock

@patch("ccusage_importer.ClickHouseImporter.run_ccusage_command")
def test_my_feature(mock_command):
    mock_command.return_value = {"daily": [{"date": "2024-01-01"}]}
    # Your test code here
```

### Local ClickHouse Setup

For integration testing, set up a local ClickHouse instance:

```bash
# Using Docker
docker run -d --name clickhouse-server \
  -p 8123:8123 -p 9000:9000 \
  clickhouse/clickhouse-server
```

## Questions?

If you have questions or need help:

1. Check the [README.md](README.md) and [CLAUDE.md](CLAUDE.md)
2. Search existing issues
3. Create a new issue with the `question` label

## License

By contributing to ccusage-import, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to ccusage-import! 🎉
