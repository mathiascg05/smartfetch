# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Published to npm as the scoped package `@mathiascg05/smartfetch`.
- Bilingual documentation: English `README.md` plus Spanish `README.es.md`.
- "Limitations and non-goals" section documenting what the library deliberately
  does not do (no `credentials`/`mode`/`redirect` passthrough, no `HEAD`/`OPTIONS`,
  no `Retry-After` handling, no backoff jitter).
- Continuous integration on GitHub Actions across Node 18, 20 and 22.
- ESLint (type-aware) and Prettier, wired into CI.
- A 100% `coverageThreshold` in `jest.config.mjs`, so uncovered branches fail the
  build.
- Contributor documentation: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, plus issue and pull request templates.

### Changed

- Source comments, JSDoc and runtime error messages translated to English.
- `LICENSE` now lists a single copyright holder, matching the authorship of the
  52 commits in the repository history. Team credit moved to the README
  acknowledgments.

### Fixed

- Corrected a stale module docblock in `src/client.ts` that claimed only `get()`
  was implemented and that timeouts and retries would arrive later; all HTTP verbs,
  the timeout and the retry engine have been present since v1.0.0.

## [1.0.0] - 2026-07-13

### Added

- `SmartFetch` HTTP client wrapping the native `fetch` (Adapter pattern) with an
  injectable adapter.
- Full HTTP verb set: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Configurable timeout backed by `AbortController`, composable with an external
  `AbortSignal`.
- Retry engine with pluggable backoff strategies (`FixedBackoff`,
  `ExponentialBackoff`) and a customizable `retryOn` predicate.
- Request and response interceptors with LIFO/FIFO ordering, error handling and
  recovery.
- Typed error hierarchy: `SmartFetchError`, `TimeoutError`, `NetworkError`,
  `HttpError` and `ParseError`, with `type` discriminator and narrowing guards.
- Response parsing via `responseType` (`json`, `text`, `blob`, `arrayBuffer`,
  `formData`), with `null` normalization for body-less statuses (204/205/304).
- Configurable success criteria through `validateStatus`.
- Client creation helpers: `createClient` (Factory), `SmartFetchBuilder` (Builder)
  and a default `smartfetch` singleton.
- Dual ESM + CommonJS build with type declarations.

[Unreleased]: https://github.com/mathiascg05/smartfetch/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mathiascg05/smartfetch/releases/tag/v1.0.0
