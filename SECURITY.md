# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/mathiascg05/smartfetch/security/advisories/new),
which notifies the maintainer without disclosing the details publicly.

Include, as far as you can:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally a minimal snippet.
- The affected version and Node.js version.

You can expect an initial response within 7 days. If the report is confirmed, a fix will be
released and you will be credited in the advisory unless you prefer otherwise.

## Supply chain

Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
(`.github/workflows/release.yml`). Provenance is a signed attestation linking the
published tarball to the exact commit and workflow run that produced it, so you can
verify a release came from this repository rather than from someone's laptop.

Verify an installed copy with:

```bash
npm audit signatures
```

The published package contains only `dist/`, the licence and the READMEs — no build
scripts run on install beyond the standard `prepare`, and there are **zero runtime
dependencies**.

## Scope

SmartFetch has **zero runtime dependencies** and performs no I/O beyond the HTTP request the
caller asks for, so its attack surface is small. Reports in scope include, for instance:

- URL construction that can be manipulated to reach an unintended host (SSRF-adjacent issues in
  `buildURL`).
- Leaking headers or credentials across redirects, retries or interceptors.
- Prototype pollution via configuration merging.

Vulnerabilities in development-only dependencies (ESLint, Jest, tsup) that do not affect consumers
of the published package are generally out of scope — the published package ships only `dist/`.
