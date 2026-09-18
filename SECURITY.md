# Security Policy

## Supported Versions

Real Write is currently maintained from the latest `master` branch. Security fixes are applied to the current public codebase unless versioned releases are introduced later.

| Version | Supported |
| ------- | --------- |
| Latest `master` | Yes |
| Older commits, forks, or modified deployments | No |

## Reporting a Vulnerability

If you find a security issue in Real Write, please do not open a public GitHub issue with exploit details, credentials, tokens, database URLs, screenshots of private configuration, or any other sensitive information.

Please report security issues privately through one of these options:

- Use GitHub's private vulnerability reporting feature, if it is enabled for the repository.
- If private reporting is not enabled, contact the repository owner directly through GitHub and ask for a private channel to share details.

When reporting a vulnerability, please include:

- A clear description of the issue
- Steps to reproduce it
- The affected page, route, API endpoint, or file
- The impact of the issue
- Any relevant logs or screenshots with secrets removed
- Suggested fix, if you already have one

## Response Expectations

I will try to acknowledge valid reports within 7 days.

If the report is accepted, I will work on a fix and may ask for more details. Once the fix is ready, the issue may be disclosed in release notes or a public issue without exposing sensitive details.

If the report is declined, I will explain why when possible.

## Scope

Security reports are especially helpful for:

- Authentication or authorization bypass
- Exposed secrets or unsafe configuration handling
- Supabase service role key exposure
- SQL injection
- Cross-site scripting
- Cross-site request forgery
- Insecure file upload handling
- Payment or payout manipulation
- Access to another user's articles, messages, projects, or payment history
- Unsafe handling of AI or plagiarism provider tokens

Out of scope:

- Vulnerabilities caused only by a user's modified fork
- Issues that require already having full admin access
- Social engineering attacks
- Spam or automated scanner noise without a reproducible impact
- Denial-of-service reports that rely only on high traffic volume

## Secret Handling

Never commit real secrets to the repository.

Keep these values private:

- Supabase service role keys
- Supabase anon keys when tied to private deployments
- Database URLs and passwords
- Hugging Face tokens
- AI detection provider API keys
- Plagiarism provider API keys
- Deployment tokens
- Runtime config files

Use environment variables or private runtime configuration for production deployments.

## Deployment Responsibility

Real Write is self-hosted software. Each deployment owner is responsible for:

- Rotating exposed credentials
- Restricting database and Supabase access
- Using HTTPS in production
- Setting correct CORS origins
- Protecting admin accounts
- Keeping dependencies updated
- Reviewing configuration before making a fork or deployment public
