# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in LLM Proxy Babylon, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, please email the maintainer or use GitHub's private vulnerability reporting feature:

1. Go to the repository's Security tab
2. Click "Report a vulnerability"
3. Provide a description of the vulnerability and steps to reproduce

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- Acknowledgment within 48 hours
- Initial assessment within 1 week
- Fix or mitigation plan within 2 weeks for confirmed vulnerabilities

## Scope

This policy covers the LLM Proxy Babylon codebase. Security issues in upstream dependencies (AWS SDK, Fastify, franc, etc.) should be reported to their respective maintainers.

## Security Considerations

This project handles LLM API requests which may contain sensitive data. When deploying:

- Run behind a reverse proxy with TLS in production
- Do not log full request/response bodies in production
- Use IAM roles instead of long-lived credentials for AWS services
- Review the conversation cache TTL settings for your data retention requirements
- The debug mode (`X-Debug: true`) exposes internal pipeline details — disable or restrict in production
