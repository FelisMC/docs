---
title: Building from source
description: The toolchain Felis needs, and how to build the backend, the panel, the images and the plugins and run the tests.
---

# Building from source {#building}

This page describes the toolchain needed to build Felis from source, and how to build the backend binary, the web panel, the container images and release assets, and how to run the tests. It is for developers. The local development workflow and the checks a change must pass are covered in [Contributing](/en/reference/contributing).

## Toolchain requirements {#requirements}

| Tool | Version | Used for |
| --- | --- | --- |
| Go | 1.27.2 (the `go` directive in `go.mod`) | Building the `felis` binary and running the Go tests |
| Node.js and npm | Node.js 22 (matching `node:22` in the `Dockerfile`) | Building and testing the panel (`panel/`, with dependencies locked in `panel/package-lock.json`) |
| JDK | 25 | Building and testing the Velocity, Paper and Limbo plugins; Paper needs a Java 25 toolchain |
| JDK | 17 | Building the Fabric, Forge and NeoForge mods |
| Docker | With BuildKit; buildx and QEMU (binfmt) for multi-architecture release assets | Building container images and release assets |
| Gradle | No separate installation | Each plugin module carries a Gradle wrapper with a pinned version and checksum |

Running Felis requires a Linux host; backend unit tests and panel development work on macOS or Linux.

## Backend {#backend}

Build the `felis` binary from the repository root:

```bash
go build -o felis ./cmd/felis
./felis help
```

::: info
A plain `go build` embeds only a placeholder page: opening the panel shows only "Felis panel assets were not built into this binary." For a complete binary that includes the panel, use the container image build below, or see [Panel](#panel).
:::

**Version**: the version `felis version` reports is set at link time, and `felis update` compares it with upstream versions. A build without a version reports `dev` and has update reporting disabled. Set the version with `-ldflags`:

```bash
go build -trimpath -ldflags "-s -w -X main.version=v0.0.0-dev" -o felis ./cmd/felis
```

The installer stamps versions in this format: release builds use the tag (such as `v1.2.3`); the `dev` channel uses `<latest-tag>+g<short-sha>`; a build pinned with `FELIS_REF` uses `v0.0.0+g<short-sha>`.

**Cross-compiling**: release builds are statically linked Linux binaries without CGO. To build for Linux on another platform:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o felis-linux-arm64 ./cmd/felis
```

**A complete binary with the panel**: build the control-plane image (see [Images](#images)) and copy the binary out of it. When installing from source, the installer obtains the host's `felis` the same way:

```bash
docker build --build-arg FELIS_VERSION=v0.0.0-dev -t felis:custom .
id="$(docker create felis:custom)"
docker cp "$id":/usr/local/bin/felis ./felis
docker rm "$id"
```

## Panel {#panel}

The panel is a React and Vite application in `panel/`:

```bash
cd panel
npm ci
npm run build
```

The output is written to `panel/dist`. When the control-plane image is built, the Dockerfile builds the panel first and copies `panel/dist` into `internal/panel/static`, where Go embeds it into the `felis` binary, so the panel and the external face are served by the same process. `internal/panel/static` holds only a placeholder in the repository; do not commit build output there.

See [Local development](/en/reference/contributing#development) for the panel's development server and mock API.

## Images {#images}

| Image | Dockerfile | Contents |
| --- | --- | --- |
| Control plane | `Dockerfile` | The panel and the `felis` binary on a distroless base; the binary is at `/usr/local/bin/felis` |
| Login space | `deploy/limbo/Dockerfile` | LOOHP/Limbo with the Felis login plugin; see [Login space image](/en/reference/limbo#build) |
| Lobby | `deploy/lobby/Dockerfile` | Paper with the Felis lobby plugin and LuckPerms; see [Lobby image](/en/reference/lobby#build) |
| General-purpose Paper | `deploy/paper/Dockerfile` | A Paper server without Felis plugins, offered as a platform-recommended image for user servers |

Build the control-plane image:

```bash
docker build --build-arg FELIS_VERSION=v0.0.0-dev -t felis:custom .
```

`FELIS_VERSION` is the version stamped into the binary; it defaults to `dev`. Every base image is pinned by digest. Use a tag other than `latest`, so that the image imported into k3s's containerd is used directly under the `IfNotPresent` pull policy.

The general-purpose Paper image uses the Paper build in `deploy/game-stack.lock`:

```bash
. <(grep '^PAPER_' deploy/game-stack.lock)
docker build -f deploy/paper/Dockerfile \
  --build-arg PAPER_JAR_URL="$PAPER_JAR_URL" --build-arg PAPER_JAR_SHA256="$PAPER_JAR_SHA256" \
  -t felis-paper:demo .
```

**Release assets**: `deploy/build-release-artifacts.sh` builds every file a release installation needs: the `felis` binary for each architecture (panel included), the control-plane image archive, the game image archive (login space, lobby, Paper), the base image archive (the registry and PostgreSQL), the image listing, `felis-velocity.jar` and `SHA256SUMS`:

```bash
deploy/build-release-artifacts.sh v0.0.0-dev /tmp/felis-assets
```

It builds `amd64` and `arm64` by default; `FELIS_RELEASE_ARCHES` selects the architectures. The script needs Docker with buildx, and binfmt with QEMU for architectures other than the build machine's; it does not need Go. The resulting directory can be installed with `FELIS_ARTIFACT_DIR`; see [Installing from pre-downloaded assets](/en/guide/deployment#offline-install).

See [Server plugins](/en/reference/plugins#building) for building the plugins.

## Running the tests {#tests}

**Go**: run from the repository root.

```bash
gofmt -l .
go vet ./...
go test -race ./...
```

To test a single package, run for example `go test ./internal/api`.

**PostgreSQL integration tests**: the SQL of the business stores is verified against a real PostgreSQL. The tests use a throwaway database whose name contains `pgint`; they drop and recreate its schema and apply the embedded migrations:

```bash
FELIS_TEST_PG_URL='postgres://felis:<password>@127.0.0.1:5432/felis_pgint?sslmode=disable' \
  go test -tags pgint ./internal/pgint/ -v
```

The database backup and restore tests also run `pg_dump`, `pg_restore` and `psql`, whose major version must match the server's. When PostgreSQL runs in a container, run those tools inside it through `FELIS_TEST_PG_EXEC`:

```bash
FELIS_TEST_PG_EXEC='docker exec -i <container>' FELIS_TEST_PG_URL='…' \
  go test -tags pgint ./internal/pgint/
```

**Shell scripts**:

```bash
sh deploy/bootstrap_test.sh
sh deploy/uninstall_test.sh
bash deploy/e2e_release_test.sh
bash deploy/e2e_upstream_test.sh
```

**Alert rules**: with Prometheus's `promtool`:

```bash
promtool check rules deploy/alerts/felis-alerts.yaml
promtool test rules deploy/alerts/felis-alerts_test.yml
```

**Panel**: run in `panel/`.

```bash
npm test                # component and unit tests (Vitest)
npm run typecheck       # TypeScript type check
npm run lint            # ESLint, no warnings allowed
npm run test:e2e        # browser tests against the mock API (Playwright, using the installed Chrome)
```

**Plugins**:

```bash
bash plugins/test.sh        # JDK 25: build and test the Velocity, Paper and Limbo plugins
bash plugins/test-mods.sh   # JDK 17: build the Fabric, Forge and NeoForge mods
```

A single group of plugin tests can also run on its own:

```bash
plugins/velocity/gradlew -p plugins/velocity routingTest
plugins/paper/gradlew    -p plugins/paper    lobbyTest
plugins/limbo/gradlew    -p plugins/limbo    loginTest \
  -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"
```

See [Tests and checks](/en/reference/contributing#testing) for every check continuous integration runs.
