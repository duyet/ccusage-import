# Security Policy

## Supported Versions

We actively support the latest version of ccusage-import with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

## Security Best Practices

### Environment Variables

**Never commit sensitive credentials to version control.**

- Use `.env` file for credentials (already in `.gitignore`)
- Never hardcode passwords, API keys, or tokens in code
- Use environment variables for all sensitive configuration

```bash
# Good - Use environment variables
CH_HOST=your_clickhouse_host
CH_PASSWORD=your_password

# Bad - Never hardcode
password = "my_actual_password"  # DON'T DO THIS
```

### ClickHouse Connection Security

#### Use HTTPS for Remote Connections

The importer automatically detects HTTPS for ports 443, 8443, and 9440:

```bash
# HTTPS is auto-enabled for these ports
CH_PORT=8443  # Uses HTTPS automatically
CH_PORT=443   # Uses HTTPS automatically
CH_PORT=9440  # Uses HTTPS automatically

# For custom ports, set protocol explicitly
CH_PORT=8124
CH_PROTOCOL=https
```

#### Network Security

- Use firewall rules to restrict ClickHouse access
- Enable authentication on ClickHouse server
- Use strong passwords for database users
- Consider using VPN for remote access
- Limit database user permissions (least privilege principle)

#### Database User Permissions

Create a dedicated user with minimal required permissions:

```sql
-- Create user with limited permissions
CREATE USER ccusage_importer IDENTIFIED BY 'strong_password';

-- Grant only necessary permissions
GRANT SELECT, INSERT ON database_name.ccusage_* TO ccusage_importer;

-- Don't grant unnecessary privileges like:
-- GRANT ALL ON *.* TO ccusage_importer;  ❌ Too permissive
```

### Data Privacy

#### Project Path Privacy

By default, project paths are hashed for privacy:

```bash
# Default: Privacy enabled (recommended for shared environments)
uv run python ccusage_importer.py

# Disable privacy only when needed (personal use, debugging)
uv run python ccusage_importer.py --no-hash-projects
```

**Use cases:**
- **Privacy Enabled** (default): Corporate environments, shared dashboards, public analytics
- **Privacy Disabled**: Personal use only, debugging, detailed project tracking

#### Machine Names

Machine names are auto-detected using `socket.gethostname()`. For sensitive environments:

```bash
# Override with generic name
export MACHINE_NAME=production-machine-1
```

### Cronjob Security

When setting up automated imports:

1. **Store credentials securely**:
   ```bash
   # Use environment file with restricted permissions
   chmod 600 ~/.env.ccusage
   ```

2. **Restrict cronjob access**:
   ```bash
   # Set proper file permissions on scripts
   chmod 700 setup_cronjob.sh
   chmod 600 ~/.env
   ```

3. **Secure log files**:
   ```bash
   # Create log directory with restricted access
   mkdir -p ~/.local/log/ccusage
   chmod 700 ~/.local/log/ccusage
   ```

### Input Validation

The importer validates:

- Date formats from ccusage output
- JSON structure from ccusage commands
- SQL injection prevention (uses parameterized queries)
- Environment variable types and formats

### Dependencies

#### Keeping Dependencies Updated

We use Renovate for automated dependency updates. To manually update:

```bash
# Update all dependencies
uv sync --upgrade

# Check for security vulnerabilities
uv pip list --outdated
```

#### Trusted Dependencies

Main dependencies:
- `clickhouse-connect` - Official ClickHouse Python client
- `pytest` - Industry-standard testing framework
- `ruff` - Modern Python linter and formatter

### Secure Development Practices

#### Before Contributing

1. **Never commit secrets**:
   ```bash
   # Check for accidentally staged secrets
   git diff --staged
   ```

2. **Scan for sensitive data**:
   ```bash
   # Search for potential secrets
   grep -r "password\|secret\|token" . --exclude-dir=.git
   ```

3. **Use `.gitignore`**:
   ```
   .env
   .env.local
   *.key
   *.pem
   credentials.json
   ```

#### Code Review Checklist

- [ ] No hardcoded credentials
- [ ] Environment variables used for sensitive config
- [ ] Input validation present
- [ ] Error messages don't leak sensitive info
- [ ] Tests don't contain real credentials
- [ ] Logs don't contain passwords or tokens

## Reporting a Vulnerability

### Where to Report

**Please do not open public GitHub issues for security vulnerabilities.**

Instead, please report security vulnerabilities by:

1. Creating a private security advisory on GitHub
2. Or by emailing the maintainers directly (check repository for contact)

### What to Include

When reporting a vulnerability, please include:

1. **Description**: Clear description of the vulnerability
2. **Impact**: Potential impact if exploited
3. **Steps to Reproduce**: Detailed reproduction steps
4. **Affected Versions**: Which versions are affected
5. **Suggested Fix**: If you have a suggested solution
6. **Your Contact**: Email for follow-up questions

### Example Report

```
Title: SQL Injection in date parameter

Description:
The date parameter in function X is not properly sanitized,
allowing potential SQL injection.

Impact:
An attacker could execute arbitrary SQL commands on the
ClickHouse database.

Affected Versions:
All versions prior to 1.2.3

Steps to Reproduce:
1. Call function X with malicious date: "'; DROP TABLE users; --"
2. Observe SQL injection occurs

Suggested Fix:
Use parameterized queries instead of string interpolation

Contact: security@example.com
```

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 90 days

### After Reporting

1. We will acknowledge receipt of your report
2. We will investigate and validate the issue
3. We will develop and test a fix
4. We will release a patch and security advisory
5. We will credit you in the advisory (if desired)

## Security Considerations

### Data at Rest

- ClickHouse data is stored on disk
- Consider encrypting ClickHouse data directories
- Implement regular backups
- Secure backup storage

### Data in Transit

- Use HTTPS for ClickHouse connections
- Enable TLS for production environments
- Verify SSL certificates

### Access Control

- Use strong passwords (20+ characters)
- Enable multi-factor authentication where possible
- Rotate credentials regularly
- Implement IP whitelisting

### Monitoring and Logging

- Monitor failed authentication attempts
- Log import activities
- Set up alerts for unusual patterns
- Regularly review logs for suspicious activity

### Regular Security Audits

Recommended periodic checks:

- [ ] Review ClickHouse user permissions
- [ ] Audit access logs
- [ ] Update dependencies
- [ ] Scan for security vulnerabilities
- [ ] Review firewall rules
- [ ] Verify TLS/SSL configuration
- [ ] Test disaster recovery procedures

## Known Security Considerations

### ccusage Data Access

The importer requires read access to ccusage JSONL files, which may contain:
- Project paths (hashed by default)
- Session IDs (hashed by default)
- Usage statistics (non-sensitive)
- Token counts (non-sensitive)

**Mitigation**: Use `--hash-projects` flag (enabled by default) to anonymize paths.

### ClickHouse Credentials

Credentials are stored in:
- `.env` file (gitignored)
- Environment variables
- Cronjob entries (only reference env vars)

**Mitigation**: Use file permissions (`chmod 600 .env`) and secure environment variable storage.

### Network Exposure

If ClickHouse is exposed to the internet:
- Enable authentication (always)
- Use HTTPS (production)
- Implement firewall rules
- Consider VPN access
- Enable rate limiting

## Security Contact

For security concerns or questions:

1. Check existing security advisories
2. Review this security policy
3. Contact maintainers privately
4. Do not disclose publicly until patched

## Acknowledgments

We appreciate the security research community's efforts in responsible disclosure. Contributors who report valid security issues will be acknowledged in our security advisories (with their permission).

---

Thank you for helping keep ccusage-import secure! 🔒
