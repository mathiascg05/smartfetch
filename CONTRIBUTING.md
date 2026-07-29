# Contributing to SmartFetch

Thanks for taking an interest. This is a small, deliberately focused library — please read the
[Limitations and non-goals](./README.md#limitations-and-non-goals) section before proposing a
feature, since some gaps are intentional rather than oversights.

## Getting set up

Requires **Node.js ≥ 18** (the library depends on a global `fetch`).

```bash
git clone https://github.com/mathiascg05/smartfetch.git
cd smartfetch
npm install
```

## Everyday commands

| Command                 | What it does                                |
| ----------------------- | ------------------------------------------- |
| `npm run lint`          | ESLint with type-aware rules                |
| `npm run lint:fix`      | Same, applying autofixes                    |
| `npm run format`        | Formats the repo with Prettier              |
| `npm run format:check`  | Verifies formatting without writing         |
| `npm run typecheck`     | `tsc --noEmit`                              |
| `npm run test`          | Jest test suite (ESM)                       |
| `npm run test:coverage` | Suite plus the 100% coverage threshold      |
| `npm run build`         | Produces `dist/` (ESM + CJS + declarations) |
| `npm run example`       | End-to-end smoke test against a real API    |

Before opening a pull request, all of these must pass:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build
```

CI runs exactly that across Node 18, 20 and 22.

## Coverage is enforced

`jest.config.mjs` sets a global `coverageThreshold` of 100% for statements, branches, functions and
lines. A pull request that adds an uncovered branch will fail CI. This is intentional: the library
is small enough that full coverage is achievable, and it keeps the number from eroding silently.

If a line genuinely cannot be covered, say so in the pull request rather than lowering the
threshold.

## Branching model

The repository follows a git-flow layout:

- `main` — released, tagged state.
- `develop` — integration branch.
- `feature/<name>` — new work, branched from `develop` and merged back into it.
- `hotfix/<name>` — urgent fixes, branched from `main` and merged into both `main` and `develop`.

Open pull requests against `develop` unless you are fixing something already released.

## Commit style

Commits follow a lightweight conventional-commits convention:

```
feat: add support for the Retry-After header
fix: propagate the abort reason during backoff waits
docs: document the interceptor execution order
test: cover the formData parse failure path
chore: bump the TypeScript version
```

Keep the subject in the imperative mood and under ~72 characters.

## Reporting bugs

Open an issue using the bug report template and include the Node version, a minimal reproduction,
what you expected and what happened instead. A failing test case is the most useful thing you can
attach.

## Code of conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
