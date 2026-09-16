# Karga Logistics

Last-mile delivery operations for a carrier working in Luanda: orders, drivers,
assignment, live tracking and proof of delivery.

> **Status: phase 1 of 9 (foundation).** The database, API skeleton, error
> contract, observability and CI are in place and tested. Authentication, orders
> and the operational map are the phases that follow. Nothing in this README
> describes something that is not in the repository — the roadmap below marks what
> exists and what does not.

---

## The problem

A carrier running deliveries needs to know, at any moment, which orders exist,
who is carrying them, where they are, which ones are late, and what proof exists
that a delivery happened. Spreadsheets and phone calls answer none of those
questions at the same time.

Karga puts that operation in one place: an operator dispatches, a driver updates
from a phone, and whoever is waiting for the parcel follows it by a code.

## Why this is not a CRUD of orders

Three decisions carry the project:

**An order's life is a state machine, not a free-form status column.** The
transitions are declared and enforced in the backend, illegal ones are refused
with `INVALID_STATE_TRANSITION`, and every accepted change appends to a history
that records who did it and when. The interface never decides what is legal.

**Tenancy is enforced at the data layer.** Every business table carries a
`company_id`, and a resource that belongs to another company answers `404` rather
than `403` — a tenant must not be able to discover that an id exists elsewhere.

**Retries must not duplicate reality.** A driver on a weak connection will send
the same "delivered" twice. Completion and proof of delivery are idempotent, so
the second attempt confirms rather than duplicates.

---

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React 19, TypeScript, Vite, React Router |
| Backend   | Node.js, TypeScript, Express 5 |
| Database  | PostgreSQL 17 |
| Realtime  | Socket.IO *(phase 6)* |
| Maps      | Leaflet + OpenStreetMap *(phase 5)* |
| Tests     | Vitest, Supertest, Testing Library |
| CI        | GitHub Actions: lint, typecheck, tests, build |

The backend is a modular monolith. Splitting an operation this size into services
would add network failure modes and buy nothing.

## Running it

Requires Node 20+ and a PostgreSQL 17 instance.

```bash
# database
createdb karga
cd backend && cp .env.example .env   # adjust DATABASE_URL
npm install && npm run migrate && npm run dev    # http://localhost:4100

# web app, in another terminal
cd frontend && npm install && npm run dev        # http://localhost:5175
```

Or with Docker, which brings its own PostgreSQL:

```bash
docker compose up
```

> The compose file has not been exercised on the machine where this was written —
> its Docker engine does not start. It is written to the same shape as the local
> setup that is verified, and will be confirmed before the deployment phase.

## Tests

```bash
cd backend  && npm test    # API contract, probes, logging, redaction
cd frontend && npm test    # page states against a stubbed API
```

The backend suite needs a database. It defaults to `karga_test` on localhost and
honours `TEST_DATABASE_URL`.

## Environment

| Variable | Meaning |
|----------|---------|
| `PORT` | Port the API binds on (default 4100) |
| `DATABASE_URL` | PostgreSQL connection string, required |
| `DATABASE_SSL` | `true` for managed providers that terminate TLS |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API with credentials |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `silent` |

The process refuses to boot on invalid configuration rather than failing later on
a request.

## API

Errors always arrive in one shape, with a request id that also appears in the
logs and in the `X-Request-Id` header:

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Uma encomenda ENTREGUE não pode voltar a EM_ENTREGA.",
    "requestId": "3f1c…"
  }
}
```

Available today: `GET /health` (liveness, touches nothing), `GET /ready`
(readiness, bounded database check) and `GET /api`. Business endpoints arrive with
their phases; see [docs/api.md](docs/api.md).

## Documentation

- [docs/architecture.md](docs/architecture.md) — layers, boundaries, decisions
- [docs/database.md](docs/database.md) — schema, migrations, indexing
- [docs/security.md](docs/security.md) — tenancy, authorization, headers, uploads
- [docs/api.md](docs/api.md) — endpoints and the error contract

## Roadmap

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Foundation: repo, database, migrations, error contract, observability, CI | **done** |
| 2 | Authentication, roles, company isolation | next |
| 3 | Customers, drivers, orders, deliveries, state machine | — |
| 4 | Assignment, operational dashboard, filters, reports | — |
| 5 | Addresses, coordinates, operational map | — |
| 6 | Socket.IO: driver location, delivery updates, notifications | — |
| 7 | Proof of delivery: photo, signature, timestamp, location | — |
| 8 | Hardening: audit, performance, security review | — |
| 9 | Deployment, screenshots, release | — |

## Technical decisions

**Money in integer minor units, weight in integer grams.** No monetary value is
ever a float. Formatting to `Kz` happens at the edge, in pt-AO.

**Coordinates in plain numeric columns, not PostGIS.** Nothing yet needs a spatial
index, and an unused extension is a dependency that breaks a build for nothing.
The columns are shaped so PostGIS can take over when a real geographic query
appears.

**Roles as a database enum.** Four roles that the code branches on belong in the
type system, not in a table an operator can edit into a state the code cannot
handle.

**Probes registered before CORS.** A misconfigured origin list must not be able to
make the service look dead to the platform hosting it.

---

Built by [Adnírcio Inocêncio](https://github.com/keny343).
