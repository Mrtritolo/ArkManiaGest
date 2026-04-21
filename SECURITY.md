# Security Policy

ArkManiaGest is a self-hosted admin panel that holds SSH credentials,
ARK admin / RCON passwords, and JWT secrets.  We take security reports
seriously.

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security reports.**

Send your report by email to:

```
info@arkmania.it
```

Please include:

- A short description of the vulnerability and its impact.
- Step-by-step instructions to reproduce it (or proof-of-concept code).
- The affected commit hash (`git rev-parse HEAD`) and any relevant
  configuration.
- Your name / handle if you would like to be credited in the fix
  notes.

We will acknowledge the report within **5 working days** and aim to
publish a fix or mitigation within **30 days** for high-severity issues
and **90 days** for low-severity issues.  We will keep you informed of
progress and credit you in the changelog if you wish.

## Scope

In scope (please report):

- Authentication / authorisation bypass, privilege escalation
- Remote code execution, SQL injection, command injection
- Insecure handling of secrets at rest or in transit
  (e.g. `FIELD_ENCRYPTION_KEY` mishandling, plaintext SSH passwords)
- CSRF / XSS in the React frontend
- SSRF via the SSH/scanner code paths
- Path traversal in the container browser or remote file editors
- Vulnerabilities in the deploy scripts that would allow a malicious
  release tarball to escalate on the server

Out of scope (do not report):

- Vulnerabilities in third-party dependencies that are already tracked
  in their own advisory databases — please report them upstream.  If
  the issue is in our usage of a dependency, however, that IS in scope.
- Findings in `reference/POK-ASA-Server` — that is an external
  upstream project; please report there directly:
  https://github.com/Acekorneya/Ark-Survival-Ascended-Server
- Issues that require physical access to the server.

## Coordinated disclosure

We follow coordinated disclosure: please give us the time window above
before publishing details.  We do not currently run a paid bug bounty
programme.
