---
title: Contributing
description: The Felis repository layout, local development workflow, tests and checks, code and interface standards, commit conventions and brand icons.
---

# Contributing {#contributing}

This page explains how to take part in Felis development: the repository layout, the local development workflow, the tests and checks a change must pass, the code and interface copy standards, the panel visual style, commit conventions, and how the brand icons are maintained. Toolchain versions and build commands are covered in [Building from source](/en/guide/building).

## Repository layout {#layout}

| Path | Contents |
| --- | --- |
| `cmd/felis/` | The entry point of the `felis` binary: every subcommand (such as `api`, `operator`, `migrate`, `reaper`, `setup`, `manifests`, `backup-now`, `db`, `update`) and the setup wizard |
| `internal/` | The backend packages; see the table below |
| `api/openapi.yaml` | The OpenAPI definition of the HTTP API, published at [/openapi.yaml](/openapi.yaml) |
| `panel/` | The React and Vite web panel; `panel/dev/` is the local mock API, `panel/e2e/` holds the browser tests |
| `plugins/` | The Velocity, Limbo and Paper plugins and the loader mods; see [Server plugins](/en/reference/plugins) |
| `deploy/` | The installer `bootstrap.sh`, the uninstall script `uninstall.sh`, the system server image Dockerfiles (`limbo/`, `lobby/`, `paper/`), the game component lock `game-stack.lock`, the alert rules `alerts/`, the CRD definitions `crd/`, the release asset script and the end-to-end test scripts |
| `assets/` | Brand icons; see [Brand icons](#brand-icons) |
| `scripts/` | Development helper scripts, such as the icon export script `generate-icons.cjs` |
| `Dockerfile` | The control-plane image |
| `bootstrap_asset.go` | Embeds the installer, the CRD and the sources the game images need into the `felis` binary, for installation paths without a source checkout |
| `.github/workflows/` | `ci.yml` (checks on pull requests and `main`), `e2e.yml` (end-to-end installation on a fresh host), `release.yml` (releases) |

The main packages in `internal/`:

| Package | Responsibility |
| --- | --- |
| `internal/api` | HTTP handlers, the route tables of both faces, authentication and access tiers |
| `internal/operator` | Reconciles `MinecraftServer` resources and creates the servers' workloads |
| `internal/apis/felis` | The type definitions of the `MinecraftServer` custom resource |
| `internal/platform` | Control-plane cluster objects: workloads, RBAC, network policies, the high-availability layout |
| `internal/store` | The business database and its embedded migrations |
| `internal/nodecontrol` | Host tasks and node operations requested from the panel |
| `internal/build`, `internal/submit` | Image builds and submissions |
| `internal/backup`, `internal/backupjob`, `internal/restore`, `internal/dbbackup`, `internal/offsite` | World backup and restore, database bundles, the off-site copy |
| `internal/panel` | The embedded web panel |

The code is split by responsibility. Change the smallest module that owns the behaviour, and avoid adding broad abstractions or rewriting nearby code.

## Local development {#development}

Most day-to-day development works on macOS or Linux without a full cluster. The complete product needs PostgreSQL and Kubernetes, but unit tests and frontend work run locally. See [Toolchain requirements](/en/guide/building#requirements) for the tools.

### Backend {#backend-development}

Build the command-line tool from the repository root:

```bash
go build -o /tmp/felis-dev ./cmd/felis
/tmp/felis-dev help
```

Render the Kubernetes manifests without contacting a cluster:

```bash
/tmp/felis-dev manifests \
  --felis-image registry.felis.svc:5000/felis:dev \
  --velocity-cidr 10.0.0.5/32
```

`felis api`, `felis operator`, `felis migrate up` and `felis reaper` are the real service commands. They need PostgreSQL or a Kubernetes configuration and are not suited to quick local iteration.

### Panel {#panel-development}

Install the dependencies in `panel/`:

```bash
cd panel
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

The mock server prints its sign-in methods and the reset command when it starts. Use it for frontend work when the Go API and a cluster are not running.

### Mock API {#mock-api}

The mock API lives in `panel/dev/` and is loaded only by `npm run dev:mock`. Its data has three accounts: `owner` (the Owner, with a linked game profile), `user` (a User, not linked) and `linked` (a User, linked). Every sign-in method is passwordless:

| Sign-in method | Input | Signs in as |
| --- | --- | --- |
| Email code | Any email address, code `123456` | `owner` |
| Bind code | `LINK1234` | `linked` |
| Passkey | Any assertion | `owner` |
| Staff login | Any email address, code `123456`; approved automatically after about 9 seconds; an address starting with `expire` lapses after 20 seconds | `owner` |

Reset the mock state:

```bash
curl -X POST http://127.0.0.1:5173/api/v1/__mock/reset
```

Mock code follows these rules:

- Mock-only logic stays in `panel/dev/`; `panel/src/` never imports mock code.
- Response shapes match `panel/src/lib/types.ts` and the Go API handlers.
- Cover realistic error codes, not only the success path.
- Never present mock data as live production data. When a new feature has no backend endpoint yet, show an explicit placeholder.

### Integration environment {#integration-environment}

For a complete integration and acceptance environment, use a clean Linux virtual machine or a disposable server, and keep normal coding and quick tests local. On that host, run the installer on the `dev` channel to build from the `main` branch:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

Common development variables:

| Variable | Effect |
| --- | --- |
| `FELIS_VERSION_BOOTSTRAP=dev` | Builds the `main` branch; the default is the newest release |
| `FELIS_REPO_URL` | Builds from the given git URL (such as your fork); effective only when the installer script runs directly through `curl` |
| `FELIS_REF` | Pins the branch, tag or commit to build, overrides the channel and forces a source build |
| `FELIS_GITHUB_TOKEN` | For private forks only: a GitHub token with read access to the fork |

`sudo` resets the environment, so variables exported before `sudo` do not reach the installer. Put the variables on the `sudo` line, or use `sudo -E`. See [Installation](/en/guide/deployment#channels) for the channels and installer behaviour, and the [Configuration reference](/en/reference/configuration#installer-variables) for every installer variable.

`sudo felis setup` reconfigures the host only with the binary already installed on it and cannot switch channels; to use another channel, run the installer again with `FELIS_VERSION_BOOTSTRAP`.

The channel determines the version stamped into the binary, which `felis update` compares with upstream. When testing update features, build through the installer or with the Dockerfile's `FELIS_VERSION` build argument; an unstamped `go build` reports `dev` and has update reporting disabled. See [Backend](/en/guide/building#backend).

## Tests and checks {#testing}

Continuous integration (`.github/workflows/ci.yml`) runs these checks on pull requests and on the `main` branch, and the release workflow runs the same checks first. Before opening a pull request, run the checks related to your change locally:

| Check | Command |
| --- | --- |
| Go formatting | `gofmt -l .` must list no files |
| Go static analysis | `go vet ./...`; staticcheck (version pinned in `ci.yml`) |
| Go tests | `go test -race ./...` |
| Go vulnerability check | `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...` |
| PostgreSQL integration tests | `go test -race -tags pgint -count=1 ./internal/pgint/`, against PostgreSQL 13 and 18 |
| Shell scripts | Syntax check with the interpreter each script's shebang names; shellcheck 0.11.0 (`-S warning`); the shell tests in `deploy/` |
| Alert rules | `promtool check rules` and `promtool test rules` |
| Panel | `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e` |
| API types | After `npm run gen:api`, `panel/src/lib/openapi.gen.ts` must show no difference |
| Plugins | `bash plugins/test.sh` (JDK 25) |
| Loader mods | `bash plugins/test-mods.sh` (JDK 17) |

See [Running the tests](/en/guide/building#tests) for how to run each suite. Also note:

- After changing `api/openapi.yaml`, run `npm run gen:api` and commit the regenerated `panel/src/lib/openapi.gen.ts`. The paths, methods, faces and access tiers in the OpenAPI definition must match the server's route tables, or the Go tests fail.
- After changing code that speaks SQL (such as `internal/api/pgrepo.go`, `internal/submit`, `internal/build` or `internal/dbbackup`), run the PostgreSQL integration tests. The unit tests use in-memory fakes; the integration tests catch drift between the fakes and the real queries.
- Before handing off a change, run at least the smallest set of checks directly related to it. If you cannot run a relevant check, say so explicitly in the pull request.

## Code standards {#code-standards}

Follow the existing code, and keep changes narrow and easy to review:

- Prefer minimal changes over rewrites.
- Introduce a new abstraction only when it removes real duplication or names a clear local concept.
- Keep mock code out of business components.
- Keep backend tests in the package that owns the behaviour.
- Preserve public API and persistence shapes unless the change explicitly needs a contract update.
- Do not commit build output, such as `panel/dist/`, `node_modules/`, Gradle build directories or local binaries.

AI-assisted work is welcome, but the contributor is responsible for the result. A pull request generated entirely by AI and not reviewed by its author is not accepted; neither are low-quality AI output, broad rewrites that ignore the current design, unverified changes, or code the author cannot explain.

## Interface copy {#interface-copy}

Interface copy uses a formal documentation style: objective, concise and precise. State the current condition, its cause or impact, and the available action. Describe confirmed facts only; avoid conversational phrasing, personification and unsupported duration estimates. Chinese instructions use explicit verbs such as “执行”, “选择”, “查看” and “配置”, and operation names match the actual interface labels. English and Chinese copy keep the same meaning and degree of formality.

The panel's interface copy lives in JSON files grouped by feature under `panel/src/i18n/resources/zh-CN/` and `panel/src/i18n/resources/en-US/`. Update both languages together; change existing entries and avoid duplicate messages or components.

## Panel visual style {#panel-visual-style}

- Reuse `PageHeader`, the `Card` family, and the shared form and button components. Card titles, borders, corner radii, spacing and save footers follow their shared definitions; do not redefine these styles in individual pages.
- The light theme uses white card backgrounds, restrained semantic colors and 16px functional icons.
- Use `CardFooter` for save actions and `Button` for interactive controls.
- Form labels use the shared `Label` style and 8px field spacing; single-line controls use the shared 36px height. Reuse `Textarea` and `Checkbox` for multiline fields and confirmations.
- Page-specific control styles only adjust layout, code fonts or semantic validation states.
- Tables, consoles, compact statistics and status messages may keep the spacing and colors their content needs.
- Keep the shared page margins and bottom spacing.

## Commits {#commits}

- Commit titles use the one-line form `type(scope): summary`, as in the repository history. Common types are `feat`, `fix`, `docs`, `refactor`, `test`, `build` and `style`; `scope` names the affected module, such as `api`, `panel` or `deploy`, and may be omitted.
- Each commit contains one related change.
- A pull request describes the change and the checks that were run.

## Brand icons {#brand-icons}

The brand icons live in the repository's `assets/icons/` and were traced by hand from a reference image. The vector files use only paths, shapes, gradients and masks, with no embedded bitmaps. Every color export derives from `assets/felis-logo.svg`.

| File | Purpose |
| --- | --- |
| `assets/felis-logo.svg` | Tightly cropped transparent vector master, 1040 × 640 |
| `assets/felis-logo.png` | The image on the repository's front page, kept at 540 × 341 |
| `assets/icons/felis-reference.svg` / `.png` | The reference image's 1254 × 1254 composition on a white background |
| `assets/icons/felis-icon.svg` | Centered square transparent icon |
| `assets/icons/felis-app.svg` / `.png` | Light-green rounded app icon, 1024 × 1024 |
| `assets/icons/felis-app-dark.svg` / `.png` | Dark-green rounded app icon, 1024 × 1024 |
| `assets/icons/felis-maskable.svg` / `.png` | Opaque square background with the cat face inside the central safe circle |
| `assets/icons/felis-monochrome.svg` | Tightly cropped black monochrome version with cut-out eyes and nose |
| `assets/icons/felis-mask.svg` | Square monochrome version for Safari pinned tabs |
| `assets/icons/png/icon-{size}.png` | Transparent icons: 16, 20, 24, 32, 40, 48, 64, 96, 128, 180, 192, 256, 512, 1024 px |
| `assets/icons/felis.ico` | Multi-resolution Windows icon: 16, 24, 32, 48, 64, 128, 256 px |
| `assets/icons/felis.icns` / `assets/icons/felis.iconset/` | macOS icon, plus 1× / 2× PNGs at 16, 32, 128, 256, 512 pt |
| `assets/icons/preview.png` | Preview of the icon set |

The web assets are in `panel/public/` and are referenced from `panel/index.html`: the SVG, ICO and PNG favicons, a 180 px Apple Touch Icon, the Safari pinned-tab icon, and regular and maskable icons at 192 / 512 px. `site.webmanifest` provides the app name and icon metadata; it does not provide offline caching.

The panel references the white rounded-square icon through `panel/src/assets/felis-logo.svg`: 28 px in the desktop sidebar and mobile navigation, 44 px in the sign-in and setup page headers. It keeps the composition of `felis-app.svg` from the set, with a white background. The build emits it under a content-hashed file name, and re-exporting updates this file as well.

The favicons are shifted down separately to align their visual center, with the same position across SVG, PNG, ICO and the Safari pinned tab; the app icons keep their original composition.

Re-export the icons after changing the vector master. This needs Node.js and `sharp`; the macOS ICNS export also uses the system's `iconutil`. Run from the repository root:

```sh
NODE_PATH=/path/to/node_modules node scripts/generate-icons.cjs
```

`NODE_PATH` points to a `node_modules` directory that has `sharp` installed. To re-export only the favicons, add `--favicons-only` to the command. The export tool adds no runtime dependency to the panel; on platforms other than macOS it still generates every format except ICNS, and the `iconset`.
