# Karga Logistics

Last-mile delivery operations for a carrier working in Luanda: orders, drivers,
assignment, live tracking and proof of delivery.

> **Status: phases 1 to 5 of 9.** Sessions, roles and company isolation are in
> place; customers, drivers and orders work end to end, driven by a state machine
> with an audited history; the operator has a dashboard whose numbers link to the
> lists behind them, an order list with filters, an order detail with a timeline and
> the actions the domain allows, a report over any window with a CSV export, and a
> map of the parcels in play that also names the ones it cannot draw. Realtime
> tracking and proof of delivery are the phases that follow. Nothing in this README
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
the same "delivered" twice. Repeating a transition that already happened is
refused as `INVALID_STATE_TRANSITION` with a message saying the order is already
there, so nothing is written twice; proof of delivery gets the same treatment in
phase 7.

The state machine, in full:

```
CRIADO → CONFIRMADO → PREPARANDO → PRONTO → ATRIBUIDO → RECOLHIDO → EM_ENTREGA → ENTREGUE
   └──────────┴────────────┴──────────┘ CANCELADO          EM_ENTREGA → FALHA_ENTREGA ⇄ EM_ENTREGA
                                                                          └→ DEVOLVIDO
```

Cancelling is possible only while the parcel is still in the warehouse: once a
driver is carrying it, the order can only end as delivered, failed or returned,
because "cancelled" would leave a physical parcel unaccounted for. `ATRIBUIDO`,
`RECOLHIDO`, `EM_ENTREGA` and `ENTREGUE` are refused without a driver attached,
and the database carries the same rule as a `CHECK` constraint.

---

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React 19, TypeScript, Vite, React Router |
| Backend   | Node.js, TypeScript, Express 5 |
| Database  | PostgreSQL 17 |
| Realtime  | Socket.IO *(phase 6)* |
| Maps      | Leaflet + OpenStreetMap |
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
npm install && npm run migrate
npm run seed                         # demo carrier, accounts, orders
npm run dev                          # http://localhost:4100

# web app, in another terminal
cd frontend && npm install && npm run dev        # http://localhost:5175
```

The seed is idempotent: run it twice and it refuses to duplicate the demo
company. It creates one carrier in Luanda, an account per role, five customers,
three drivers and fourteen orders spread across the state machine — including a
failed delivery, a return, and one order left without coordinates on purpose, so no
screen is empty, no screen is uniform, and the panel listing what the map cannot draw
is actually visible.

| Demo account | Role | Sees |
|--------------|------|------|
| `admin@karga.ao` | ADMIN | everything |
| `operador@karga.ao` | OPERADOR | dashboard, orders, customers, drivers |
| `motorista@karga.ao` | MOTORISTA | only the orders assigned to him |
| `cliente@karga.ao` | CLIENTE | only the orders placed for him |

Password `Karga2026!` for all four. They exist only in the seed of a local
database.

Or with Docker, which brings its own PostgreSQL:

```bash
docker compose up
```

> The compose file has not been exercised on the machine where this was written —
> its Docker engine does not start. It is written to the same shape as the local
> setup that is verified, and will be confirmed before the deployment phase.

## Tests

```bash
cd backend  && npm test    # 125 tests
cd frontend && npm test    # 39 tests
```

The backend suite runs against a real PostgreSQL, not mocks: what is worth
testing here is that the constraints, the tenancy filters and the state machine
hold together. It covers every ordered pair of statuses against the transition
table, login and lockout, session revocation, role refusals, cross-company
requests answering `404`, assignment rules — including two operators assigning the
same driver at the same moment, where exactly one must win — and the full path from
creation to delivery. Reports are tested for what falls inside a window and what does
not, for the median rather than the mean, and for the CSV rules — escaping, and the
neutralisation of a value a spreadsheet would execute. The map is tested for the
scope each role gets, for the orders it reports as undrawable, and for the two
refusals that matter: a swapped coordinate pair and a finished order. The frontend
suite covers the screens' loading, empty and error states against a stubbed API, and
tests the map by what it asks Leaflet to draw rather than by rendering tiles.

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

Available today: probes (`GET /health`, `GET /ready`), sessions
(`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`), the
dashboard aggregate, orders (list, create, read, assign, change state, set
destination coordinates), customers, drivers, reports
(`GET /api/reports/summary`, `GET /api/reports/orders.csv`) and the map
(`GET /api/map/operation`). Full contract in [docs/api.md](docs/api.md).

## Documentation

- [docs/architecture.md](docs/architecture.md) — layers, boundaries, decisions
- [docs/database.md](docs/database.md) — schema, migrations, indexing
- [docs/security.md](docs/security.md) — tenancy, authorization, headers, uploads
- [docs/api.md](docs/api.md) — endpoints and the error contract

## Roadmap

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Foundation: repo, database, migrations, error contract, observability, CI | **done** |
| 2 | Authentication, roles, company isolation | **done** |
| 3 | Customers, drivers, orders, state machine, assignment | **done** |
| 4 | Reports, CSV export, dashboard that leads somewhere | **done** |
| 5 | Coordinates and the operational map | **done** |
| 6 | Socket.IO: driver location, delivery updates, notifications | next |
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

**Server-side sessions in an httpOnly cookie, not a JWT.** A retired session has
to stop working now, not when it expires, and a self-contained token cannot be
taken back. Only a SHA-256 hash of the token is stored, so a database dump does
not hand over live sessions.

**Login throttling in the database, not in process memory.** A counter that resets
on every deploy protects nobody, and two instances would each keep their own.
Five failures on an account within fifteen minutes lock it out; twenty from one
address do the same.

**Addresses as columns on the row that owns them.** An order's destination is a
snapshot. If a customer moves next month, a delivery from last month must still
say where it actually went, and a foreign key to an editable address would let an
update rewrite history.

**Order codes from one sequence for the whole installation.** Numbering per
company would produce two `KRG-000001`, and a public tracking link has nothing
else to tell them apart.

**One parcel per driver, enforced by a partial unique index.** The service already
refuses a second assignment, but it counts the driver's open orders inside a
transaction that locks the *order* row: two operators assigning the same driver to
two different orders would both read zero. The rule belongs where a race cannot get
past it, and the loser still gets the sentence explaining why.

**"Today" means today in Luanda.** Day boundaries are computed
`AT TIME ZONE 'Africa/Luanda'` rather than left to the database's configured zone,
which in production is UTC. Otherwise, for the hour before midnight, the dashboard
would report no orders while the day's parcels were already on the road.

**Median delivery time, not average.** One parcel that sat in the warehouse over a
weekend pulls a mean far enough to make it useless for planning a day. And with
nothing finished in the window the success rate is reported as *no data* rather than
0%, because 0% claims every delivery failed.

**Exported values are neutralised against the spreadsheet that opens them.** A field
starting with `=`, `+`, `-` or `@` gets an apostrophe in front of it. The names in an
export were typed into a form by somebody other than the operator opening the file,
and `=HYPERLINK(...)` in a customer name is an attack rather than a typo.

**A KPI is a link.** "Seven late" is a question, and the answer is a filtered list, so
the card is one click from the rows behind it. The list shows that it is filtered and
offers the way out — a short list with no visible reason is a bug report waiting to
happen.

**Coordinates are pinned by hand, not geocoded.** An address in Luanda is usually a
description and a landmark — "Via S8, loja 4, em frente ao Talatona Imperial" — which
is exactly how somebody finds it and exactly what a geocoder cannot resolve. The
operator who knows the place drops the pin, and the written address is never
overwritten by it.

**A point that would be inside Angola if the numbers were swapped is refused by
name.** `13.23, -8.83` is a valid pair in the Atlantic, and on a zoomed-in map a
marker there is not obviously wrong. The API answers with the corrected pair rather
than "coordenadas inválidas", which would leave whoever typed them hunting for a
mistake that is one exchange away.

**The map reports what it cannot draw.** Open orders without coordinates come back as
their own list, counted and linked. A map that quietly omits three parcels is worse
than one that says so: the dispatcher counts markers and believes them. For the same
reason, parcels sharing an address collapse into a single pin labelled with how many
are there, instead of stacking invisibly and contradicting the total.

**Leaflet driven directly, without a React wrapper.** A wrapper is a second
dependency that has to keep pace with both React and Leaflet, and what it buys is one
file: Leaflet owns the DOM inside the container, React owns the container.

**The map is loaded on demand.** Leaflet and its stylesheet are a third of the
application's weight and are needed by two screens, so they are a separate chunk:
103 kB gzipped for everyone, 44 kB more only for whoever opens a map. A driver
checking his list on a phone connection should not pay for it.

**Probes registered before CORS.** A misconfigured origin list must not be able to
make the service look dead to the platform hosting it.

---

Built by [Adnírcio Inocêncio](https://github.com/keny343).
