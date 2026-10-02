---
title: API definition
---

# API definition {#api-定义}

[Download the complete OpenAPI 3.1 definition](/openapi.yaml).

Control plane for the Felis Minecraft orchestration platform. The same binary
exposes an internal face (per-caller service tokens, for velocity / backend
callbacks, never Zero Trust) and an external face (the felis_session cookie, for
people and the panel; Cloudflare Access, when present, is enforced at the edge).
Admin-tier external operations additionally require a staff session on the
operator console host. See `x-felis-face` / `x-felis-tier` on each operation.

Behaviour every operation shares, and so not repeated under each:

* Every response carries `X-Request-Id` (a well-formed inbound one is kept),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` and `Content-Security-Policy: default-src 'none'`.
  `Strict-Transport-Security` is added when the request came through the TLS
  edge (`X-Forwarded-Proto: https`).
* A path no operation serves is `404 not_found`; a path served under other
  methods is `405 method_not_allowed` with an `Allow` header.
* A POST/PUT/PATCH/DELETE a browser sends from another site (`Sec-Fetch-Site`
  `same-site` or `cross-site`, or an `Origin` whose host is not the request's)
  is `403 cross_site`, before authentication. Callers that send neither header
  (the plugins, scripts) are unaffected.
* A JSON body over 1 MiB is `413 too_large`. A request body must keep arriving:
  after 30 s it has to average 16 KiB/s or the connection is closed.
* Event streams (the console and build logs) tag each line with `id:` (unix
  seconds); an EventSource that reconnects with `Last-Event-ID` within the hour
  resumes from that second instead of the tailed backlog. The server re-checks
  the caller every minute and ends the stream with `event: revoked` once the
  session or the access is gone; a stream also closes after 30 minutes and on
  server shutdown, and the client simply reconnects.

## Definition and verification scope {#定义与验证范围}

```text
felis-api — OpenAPI 3.1 description of both faces (spec §7, §14, §28 #7).

ONE binary serves TWO http.Handlers (internal / external). This document
describes both, distinguished per-operation by the `x-felis-face` extension
(an array, because `/healthz` is served by both faces) and `x-felis-tier`
(the Zero-Trust grade: public | service | app | admin).

VERIFIED vs. HAND-MAINTAINED — read before trusting a field:
  * The {method, path} -> {x-felis-face set, x-felis-tier} mapping is
    machine-checked. internal/api/openapi_test.go parses this file and asserts
    EXACT bidirectional parity against the route tables the handlers are built
    from (internalAPIRoutes / externalAPIRoutes in internal/api/api.go). A route
    added, removed, re-faced, or re-tiered without updating this file fails
    `go test ./...`. So path, method, face and tier are as trustworthy as the code.
  * Which operations a setup-lockdown session may still use (x-felis-setup-allowed)
    is checked the same way against the SetupAllowed flag in those tables.
  * The named response schemas are compared field by field with the Go structs
    the handlers encode (internal/api/openapi_parity_test.go).
  * Every request the handler tests send is held to this file once the package
    has run (internal/api/openapi_contract_test.go): the operation (or
    x-felis-common-responses) must list the status that came back, a JSON response
    must fit the schema for that status and carry no property it does not name,
    and the JSON request behind a 2xx must fit the requestBody. Statuses and
    bodies no test reaches are still hand-maintained.

The deployment zone (RootDomain, spec §2) never appears here — `example.test`
is a placeholder, per the no-hardcoded-domain red line.
```

---

Source: [docs/openapi.yaml](https://github.com/FelisMC/Felis/blob/main/docs/openapi.yaml).
