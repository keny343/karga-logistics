# Karga Logistics

Last-mile delivery operations for a carrier working in Luanda: orders, drivers,
assignment, live tracking and proof of delivery.

> **Status: phases 1 to 6 of 9.** Sessions, roles and company isolation are in
> place; customers, drivers and orders work end to end, driven by a state machine
> with an audited history; the operator has a dashboard whose numbers link to the
> lists behind them, an order list with filters, an order detail with a timeline and
> the actions the domain allows, a report over any window with a CSV export, and a
> map of the parcels in play that also names the ones it cannot draw. The screens
> now keep themselves current over a socket, drivers appear on the map while they
> move if they choose to share their position, and the person who has to act is told
> rather than left to notice. Proof of delivery is next. Nothing in this README
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
there, so nothing is written twice. The same photograph sent twice is deduplicated
by the hash of its bytes, so a driver who taps upload again on a stalled connection
ends up with one proof, not two.

And a delivery is claimed, not typed: `ENTREGUE` is refused with `PROOF_REQUIRED`
until at least one proof exists — a photograph at the door or a signature from
whoever received the parcel. One, not both: a camera that will not focus in a dark
stairwell, or a customer who refuses to sign, must not be able to block a delivery
that actually happened.

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
| Realtime  | Socket.IO |
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

Every order that reached a door carries proof of what happened there — the delivered
ones a photograph and a signature, the failed attempt only a photograph — because the
application refuses to close a delivery without one, and a demonstration that
contradicts its own rule is worse than none. The images are drawn in code
(`src/db/imagensDemo.ts`): a parcel on a step and a signature on a line, encoded as
PNG. They read as placeholders, which is what they are. `npm run seed:reset` drops the
demo carrier and seeds it again, and touches nothing else.

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
cd backend  && npm test    # 177 tests
cd frontend && npm test    # 78 tests
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
refusals that matter: a swapped coordinate pair and a finished order.

The realtime tests start a real server and connect real clients, because who receives
what lives in the handshake, the rooms and the session — none of which a mocked socket
would exercise. They assert the things that would be quiet failures: that a socket with
no session is refused, that an event never crosses into another company, that one driver
never sees another, that a position from a browser is validated and rate limited, and
that logging out closes the sockets left open elsewhere.

`tests/jornada.test.ts` plays one working afternoon with all six people signed in at
once: an operator dispatches, a driver reports in from the road, the first delivery
attempt fails and the second works, a customer follows her parcel and an admin closes
the books. Two kinds of bug are only reachable this way. A leak between people who are
online together — a rival carrier's operator and a second driver stay connected from
the first line to the last, recording everything, and the test ends by asserting they
were told nothing. And a story that stops making sense halfway: each step asserts
against what the last one produced, so a change that breaks the chain between two
features fails here even when both still pass their own tests.

The upload tests are mostly refusals, because that is where an upload endpoint is
either safe or not: a PNG renamed `.jpg`, an SVG declaring itself a JPEG, a file over
the limit, a request with no file at all, coordinates outside Angola, a capture time in
the future, the same bytes sent twice, and the eleventh proof on an order that is
allowed ten. Then the scope: a driver may only prove his own deliveries, a customer may
look and not attach, and another carrier gets `404` for the order, the list and the
file alike.

The frontend suite covers the screens' loading, empty and error states against a stubbed
API, tests the map by what it asks Leaflet to draw rather than by rendering tiles, and
tests the driver's position sharing against a fake geolocation — including the states
where it should refuse to claim it is working. Proof capture is tested against a fake
canvas: that a photograph is downscaled and converted before it leaves the phone, that a
signature only becomes attachable once something has been drawn, and that a delivery
refused for want of proof puts the instruction next to the camera it is asking for.

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
destination coordinates), delivery proofs (`POST /api/orders/:id/proofs`,
`GET /api/orders/:id/proofs`, `GET /api/orders/:id/proofs/:proofId/file`),
customers, drivers, reports
(`GET /api/reports/summary`, `GET /api/reports/orders.csv`) and the map
(`GET /api/map/operation`). Live updates arrive over Socket.IO on `/realtime`,
authenticated by the same session cookie. Full contract in
[docs/api.md](docs/api.md).

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
| 6 | Socket.IO: driver location, delivery updates, notifications | **done** |
| 7 | Proof of delivery: photo, signature, timestamp, location | **done** |
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
119 kB gzipped for everyone, 45 kB more only for whoever opens a map. A driver
checking his list on a phone connection should not pay for it. The socket client is
in the main bundle and costs around 15 kB of that figure — it is not split, because
every signed-in screen uses it and a lazy chunk would only delay the connection.

**The socket is authenticated by the session cookie, not by a token of its own.** The
handshake resolves the same cookie with the same function the HTTP middleware uses. A
second credential path would be a second thing to get wrong, and an attacker uses the
weaker of the two.

**Rooms are assigned at connect, from the session; a client cannot subscribe.** Every
room name starts with the company id, and there is no message that joins one, because
such a message is a request to name somebody else's room. Narrowing after a payload
arrives in the wrong browser is not narrowing.

**Services publish through a bus, not through the socket server.** The HTTP path works
identically with no realtime attached — the suite runs that way, and so would a deploy
with the socket layer down. A publish is fire-and-forget: a delivery that was recorded
must not fail because a browser could not be told.

**Events say something changed; the screen asks the API what.** A payload could be
patched into a row, but whether the order still belongs in this filter, on this page or
in that map group is a question about all of them. Bursts are collapsed into one
refetch, and reconnecting triggers one too — a socket that was down has missed events
and cannot know which.

**Only the driver's last position is stored, upserted, with no trail.** A point every
ten seconds is some nine thousand rows per driver per day, and no screen answers a
question that needs the history. When one exists it gets its own table sampled for that
question, rather than inheriting the rate a phone happened to report at.

**A position is drawn as a claim, not a fact.** It carries the accuracy the phone
reported and the moment it arrived, both shown in the popup, and anything older than
fifteen minutes is not drawn at all: by then the courier may have finished, gone home,
or closed the page that was reporting.

**Position sharing is opt-in, per session, and says what it costs.** A phone that
reports its location without being asked is surveillance, whoever owns it. The card
states that it works only while the page is open — a browser stops watching when the tab
goes away — and that it sends a point every ten seconds, which on a data bundle bought
by the megabyte is information a driver is owed before agreeing. It refuses to say the
office can see him until the server has acknowledged a point.

**A dead socket is visible.** A dispatcher watching a list that has quietly stopped
changing believes the operation is calm, so the header always says whether the screens
are updating themselves. The distinction between "nothing is happening" and "I am no
longer being told" is the whole reason the indicator exists.

**Proof bytes live in Postgres, as `bytea`.** Object storage is where a million
photographs belong, and this will move there when the volume says so. It does not say so
yet, and the version that stores them in the database has properties the split version
does not: a proof and the transaction that accepted it commit or fail together, there is
no orphaned object to reconcile after a failed upload, and a restore brings back the
evidence with the delivery it belongs to. It also keeps the deployment to one managed
service instead of a bucket, a lifecycle policy and a set of credentials, on a platform
whose filesystem is wiped on every deploy. Photographs are downscaled in the browser
before they are sent and capped at 5 MB, ten per order, so the ceiling is known.

**An uploaded image is verified by its bytes, never by what it says it is.** The
declared type, the extension and the first bytes of the file all have to agree, and
those bytes are the ones that decide — a `.jpg` that begins `<svg` is refused, because a
filename is a claim and a magic number is evidence. What is served back is served with
`nosniff`, a `default-src 'none'` policy and a generated filename: the client's name is
never echoed, since a name is a path in disguise and it would arrive in somebody's
download folder.

**A proof records the phone's time and the server's, and shows both when they differ.**
A driver in a dead zone photographs the parcel at the door and the upload lands twenty
minutes later at a junction with signal. Smoothing that into one timestamp would be
inventing evidence, so the panel says "16:40, recebida 17:02" and leaves the reader to
draw the conclusion. Location is the same: recorded with the accuracy the phone
reported, or shown as "Sem posição" when it could not get a fix — a proof without a
point is still a proof, it just does not say where.

**Probes registered before CORS.** A misconfigured origin list must not be able to
make the service look dead to the platform hosting it.

---

Built by [Adnírcio Inocêncio](https://github.com/keny343).
