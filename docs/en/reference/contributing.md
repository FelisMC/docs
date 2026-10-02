---
title: Contributing
---

# Felis Contributor Guide {#felis-contributor-guide}

This document is the practical entry point for contributors. It focuses on how to
run, test, and reason about the project while keeping changes small and aligned
with the current codebase.

## Project Shape {#project-shape}

Felis is a Kubernetes-native Minecraft server control plane. The repository has
four main areas:

- `cmd/felis/`: the single Go CLI binary. It dispatches subcommands such as
  `api`, `operator`, `migrate`, `reaper`, `restore`, `manifests`, and
  `breakGlass`.
- `internal/`: backend packages for API handlers, store migrations, Kubernetes
  rendering, operator reconciliation, build, backup, restore, and related domain
  logic.
- `panel/`: the React/Vite web control panel.
- `plugins/`: Minecraft-side plugins and mods for Velocity, Paper, Fabric,
  Forge, and NeoForge.

The codebase is intentionally split by responsibility. Prefer changing the
smallest owning module instead of adding broad abstractions or rebuilding nearby
code.

## Local Development {#local-development}

You can do most day-to-day development on macOS or Linux without a full cluster.
The full product needs Postgres and Kubernetes, but unit tests and frontend work
run locally.

Recommended local tools:

- Go matching `go.mod`
- Node.js and npm for `panel/`
- Optional: JDK/Gradle for plugin work
- Optional integration environment: a clean Linux VM or server with Docker,
  k3s, and Postgres

Check tool versions:

```bash
go version
node --version
npm --version
java -version
```

## Backend Commands {#backend-commands}

Run these from the repository root:

```bash
cd /path/to/Felis
```

Run all Go tests:

```bash
go test ./...
```

Run a focused package:

```bash
go test ./internal/api
go test ./cmd/felis
```

The hermetic suites run against in-memory fakes; the business stores' SQL is
verified separately against a real Postgres, on a throwaway database whose name
must contain `pgint` (the harness drops and recreates its schema and replays the
embedded migrations):

```bash
FELIS_TEST_PG_URL='postgres://felis:***@127.0.0.1:5432/felis_pgint?sslmode=disable' \
  go test -tags pgint ./internal/pgint/ -v
```

Run it after touching anything under `internal/api/pgrepo.go`, `internal/submit`,
`internal/build` or `internal/dbbackup` that speaks SQL: the fakes encode the
contract, and this suite exists to catch the drift between the fakes and the real
queries. The `felis db backup` and `restore` tests also run `pg_dump`, `pg_restore`
and `psql`, which must be the server's major version. For a server in a container,
run them in it, as production does in felis-postgres:

```bash
FELIS_TEST_PG_EXEC='docker exec -i <container>' FELIS_TEST_PG_URL=... go test -tags pgint ./internal/pgint/
```

Build the CLI:

```bash
go build -o /tmp/felis-dev ./cmd/felis
/tmp/felis-dev help
```

Render Kubernetes manifests without contacting a cluster:

```bash
/tmp/felis-dev manifests \
  --felis-image registry.felis.svc:5000/felis:dev \
  --velocity-cidr 10.0.0.5/32
```

`felis api`, `felis operator`, `felis migrate up`, and `felis reaper` are real
runtime commands. They need external services such as Postgres and/or a
Kubernetes config, so they are not the first choice for quick local iteration.

## Frontend Commands {#frontend-commands}

Run these from the frontend workspace:

```bash
cd /path/to/Felis/panel
```

Install dependencies:

```bash
npm ci
```

Run against a real backend at `http://localhost:8080`:

```bash
npm run dev
```

Run with the local mock API:

```bash
npm run dev:mock
```

The mock dev server prints its accounts, link code, and reset command when it
starts. Use it for frontend work when you do not have the Go API and cluster
running.

Common frontend checks:

```bash
npm run typecheck
npm test
npm run build
```

## Mock API {#mock-api}

The frontend mock API lives under `panel/dev/` and is loaded only by
`npm run dev:mock`. It must not leak into production code or business
components.

Run mock commands from the frontend workspace:

```bash
cd /path/to/Felis/panel
npm run dev:mock
```

Current mock accounts:

| Username | Password | Scenario |
| --- | --- | --- |
| `owner` | `devpassword` | admin, linked |
| `user` | `devpassword` | normal user, not linked |
| `linked` | `devpassword` | normal user, linked |
| `setup` | `devpassword` | admin, first-login password change |

Mock Minecraft link code:

```text
LINK1234
```

Reset mock state:

```bash
curl -X POST http://127.0.0.1:5173/api/v1/__mock/reset
```

Mock rules:

- Keep mock-only logic in `panel/dev/`.
- Do not import mock code from `panel/src/`.
- Keep response shapes aligned with `panel/src/lib/types.ts` and the Go API
  handlers.
- Prefer realistic error codes over happy-path-only mocks.
- Do not present mock data as live production data.

## Full Integration Environment {#full-integration-environment}

Run integration/deploy commands from the repository root on the Linux host:

```bash
cd /path/to/Felis
```

The setup TUI is intended for a clean Linux host, not a typical macOS
development machine:

```bash
sudo felis setup
```

Useful overrides:

```bash
export FELIS_REPO_URL=<your fork url>
export FELIS_REF=<your branch>          # pins the build; overrides the channel below
export FELIS_IMAGE=felis:dev
export FELIS_ROOT_DOMAIN=<node-ip>.nip.io
```

By default the installer builds the newest **published GitHub release**. Building the
development tip needs an opt-in, and installing from a private fork additionally needs a
token for the release lookup and the clone:

```bash
export FELIS_VERSION_BOOTSTRAP=dev      # build main instead of the newest release
export FELIS_GITHUB_TOKEN=<token>       # private forks only: read access to the fork
```

`dev` is also the escape hatch before the first `vX.Y.Z` tag exists: with no published
release the default channel has nothing to resolve and stops with that instruction.

A release install downloads that tag's CI-built binary, images and Velocity plugin, verifies
`SHA256SUMS`, and imports them; the panel is embedded in the same binary (`internal/panel`).
`dev` clones and compiles from source. Missing or unusable release assets fall back to a
host build of **the same tag**, with a warning for the affected component. The installer
never silently changes commits. `FELIS_REF` forces the source path. See
[Installation and deployment](/en/guide/deployment) and
[Where the binary and images come from](/en/operations/#where-the-binary-and-the-images-come-from)
for the current installation behavior.

The channel decides the version stamp linked into the binary (`felis version`), which is
what `felis update` compares against upstream — release builds stamp the tag, dev builds
stamp `<latest-tag>+g<short-sha>`, and a pinned `FELIS_REF` stamps `v0.0.0+g<short-sha>`
because skipping channel resolution also skips the tag lookup. An unstamped build reports
`dev` and update reporting
is disabled for it, so build through `bootstrap.sh` (or the Dockerfile's `FELIS_VERSION`
build arg) rather than a bare `go build` when testing that path.

The setup flow wraps the host bootstrap, then continues to Owner account setup
and optional Cloudflare edge setup in the same command. The raw
`deploy/bootstrap.sh` script remains available for low-level host provisioning
when debugging the installer itself.

Use a VM or disposable Linux server for this. Treat it as an integration and
acceptance environment, while keeping normal coding and quick tests local.

## Plugin Development {#plugin-development}

Plugin docs live in `plugins/README.md`.

The plugin modules intentionally use separate Gradle builds:

```bash
# cwd: repository root
cd /path/to/Felis

bash plugins/velocity/gradlew -p plugins/velocity build
bash plugins/paper/gradlew -p plugins/paper build
bash plugins/fabric/gradlew -p plugins/fabric build
bash plugins/forge/gradlew -p plugins/forge build
bash plugins/neoforge/gradlew -p plugins/neoforge build
```

Notes:

- Fabric/Forge/NeoForge use module wrappers.
- Velocity, Paper and Limbo also use their module wrappers.
- Java and Minecraft version requirements are listed in the [plugin version table](/en/reference/plugins#minecraft-versions).
- Paper currently needs a Java 25 toolchain; use the requirements of each module.
- First builds may be slow because Minecraft dependencies are downloaded and
  remapped.

## Frontend Status {#frontend-status}

The panel is still in early development. It currently offers server lists and status,
wake/stop/claim, console and RCON, file management, account linking,
whitelist/ban/OP/LuckPerms management, scheduled tasks, and backup and restore.
The current feature scope follows the [Project README](/en/reference/readme-en#features)
and the relevant backend endpoints. The mock API is for local frontend development.

Keep UI state accurate when adding features. An endpoint that does not exist should have
an explicit placeholder, never fake live data. Interaction depth and component/browser
test coverage still need work.

## i18n Notes {#i18n-notes}

This section concerns the **Felis control panel**; the documentation site has its own language switch.
Panel i18n is not yet established as a full system. User-facing strings are currently
mostly inline in TSX and helper functions.

Good first targets:

- Error messages mapped from stable API error codes
- Navigation labels
- Page titles and primary actions
- Phase/status labels
- Empty/loading/error states

Recommended initial approach:

```text
panel/src/i18n/
  index.ts
  en.ts
  zh-CN.ts
```

Use a small typed dictionary first. Add a larger library such as
`i18next/react-i18next` only when the project needs runtime language switching,
pluralization rules, external translation workflows, or more complex
localization behavior.

Do not translate code comments, internal logs, or mock-only terminal messages
unless there is a clear contributor need.

## Contribution Style {#contribution-style}

Follow the existing code. Keep changes narrow and easy to review.

Guidelines:

- Prefer minimal changes over rewrites.
- Do not add a new abstraction unless it removes real duplication or names a
  strong local concept.
- Keep frontend mock code out of business components.
- Keep backend tests close to the package that owns the behavior.
- Preserve public API and persistence shapes unless the change explicitly needs a
  contract update.
- Do not commit generated build output such as `panel/dist/`, `node_modules/`,
  Gradle build directories, or local binaries.

AI-assisted work is welcome, but the contributor is responsible for the result.
Do not submit a PR that is entirely AI-generated and not personally reviewed.
Low-quality AI dumps, broad rewrites that ignore the current design, unverified
changes, or code the author cannot explain will not be accepted.

Before handing off a change, run the smallest meaningful checks:

```bash
go test ./...
cd panel && npm run typecheck && npm test && npm run build
```

If you cannot run a relevant check, say so explicitly in the handoff.

---

Source: [CONTRIBUTING.md](https://github.com/FelisMC/Felis/blob/main/CONTRIBUTING.md). Installation and feature status are also synchronized with the main README and plugin documentation.
