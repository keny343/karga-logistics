# API

Base path `/api`. Everything except `/api/auth/login`, `/api/auth/logout` and
`/api/auth/me` requires a session cookie.

## Error contract

Every failure, from validation to an unhandled exception, arrives in one shape:

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "A encomenda KRG-000006 está em EM_ENTREGA e só pode passar a ENTREGUE ou FALHA_ENTREGA. CANCELADO não é permitido.",
    "requestId": "3f1c…",
    "details": [{ "field": "weightGrams", "message": "Required" }]
  }
}
```

`details` appears only for validation failures. `requestId` is also in the
`X-Request-Id` response header and in every log line for that request. Stack
traces never reach a client.

| Code | Status | Meaning |
|------|--------|---------|
| `VALIDATION_ERROR` | 400 | The payload or query string is not acceptable |
| `UNAUTHENTICATED` | 401 | No session, or a session that no longer exists |
| `FORBIDDEN` | 403 | Authenticated, but the role does not allow this |
| `NOT_FOUND` | 404 | Absent, or belonging to another company |
| `CONFLICT` | 409 | The request contradicts the current state of the data |
| `INVALID_STATE_TRANSITION` | 409 | The order cannot move that way |
| `PROOF_REQUIRED` | 409 | `ENTREGUE` was asked for on an order with no proof attached |
| `PAYLOAD_TOO_LARGE` | 413 | The body, or an uploaded image, is over the limit |
| `RATE_LIMITED` | 429 | Too many requests, or too many failed logins |
| `INTERNAL_ERROR` | 500 | Unexpected; the request id is the way to find it |
| `SERVICE_UNAVAILABLE` | 503 | Readiness probe could not reach the database |

A resource from another company is reported as `404`, never `403`: a tenant must
not be able to discover that an id exists somewhere else.

## Probes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Liveness. Touches nothing, registered before CORS |
| GET | `/ready` | Readiness. Bounded database check, `503` when it fails |

## Sessions

| Method | Path | Roles |
|--------|------|-------|
| POST | `/api/auth/login` | anonymous |
| POST | `/api/auth/logout` | any |
| GET | `/api/auth/me` | any |

`POST /api/auth/login` takes `{ email, password, companySlug? }`. It sets an
httpOnly, SameSite=Lax cookie and returns the user. Wrong password and unknown
account answer identically, so the endpoint cannot be used to enumerate accounts.
`companySlug` is needed only when the same email exists in more than one company,
which answers `409` until the company is named.

`GET /api/auth/me` answers `200` with `{ "user": null }` when nobody is signed in.
A `401` would be correct HTTP and a bad idea: the browser would log a failed
request on every anonymous page load and real faults would be lost among them.

## Dashboard

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/dashboard` | ADMIN, OPERADOR |

Counts for today, in-flight, delivered, failed and late orders; drivers on duty;
a breakdown by status; a fourteen-day series with zero-filled days; and the eight
most recent orders.

## Orders

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/orders` | any, narrowed by role |
| POST | `/api/orders` | ADMIN, OPERADOR |
| GET | `/api/orders/:id` | any, narrowed by role |
| POST | `/api/orders/:id/assign` | ADMIN, OPERADOR |
| POST | `/api/orders/:id/status` | ADMIN, OPERADOR, MOTORISTA |

Query parameters on the list: `status`, `search` (code, customer or destination),
`driverId`, `late=true`, `page`, `pageSize` (capped at 100). A driver's list is
narrowed to the orders assigned to him and a customer's to the orders placed for
them, from the session — never from the query string.

An order carries `allowedTransitions`, the states it may move to right now. The
interface renders exactly those as buttons, so it cannot offer a move the API
would refuse.

`POST /api/orders` takes money as integer `valueCents` and weight as integer
`weightGrams`. `POST /api/orders/:id/assign` takes `{ driverId }` and refuses a
driver who is off duty or already carrying a parcel, with a message that says
which. `POST /api/orders/:id/status` takes `{ status, note? }`; the note is kept in
the history and is how a failed delivery gets explained. Asking for `ENTREGUE` on an
order with no proof attached is refused with `PROOF_REQUIRED`.

## Delivery proofs

| Method | Path | Roles |
|--------|------|-------|
| POST | `/api/orders/:id/proofs` | ADMIN, OPERADOR, MOTORISTA |
| GET | `/api/orders/:id/proofs` | any, narrowed by role |
| GET | `/api/orders/:id/proofs/:proofId/file` | any, narrowed by role |

Attaching is `multipart/form-data` with the image in `file` and the rest as fields:
`kind` (`FOTO` or `ASSINATURA`), and optionally `latitude`, `longitude`,
`accuracyMeters` and `capturedAt` as reported by the device. JPEG, PNG or WebP, up to
5 MB, up to ten per order, and only from `RECOLHIDO` onwards — there is nothing to
prove about a parcel still in the warehouse. The same bytes sent twice return the
proof that already exists rather than a second one.

The refusals are specific on purpose: a file whose magic bytes contradict its declared
type or its extension is `VALIDATION_ERROR` naming both, an oversized image is
`PAYLOAD_TOO_LARGE`, a point outside Angola or a capture time in the future is
`VALIDATION_ERROR`, and the eleventh proof is `CONFLICT`.

The list returns metadata and a URL per proof — never bytes — with `capturedAt` from
the device beside `storedAt` from the server, the coordinates and accuracy if there
were any, the uploader, the byte size and the SHA-256. The file endpoint returns the
bytes with `Cache-Control: private`, an `ETag` of the hash, `nosniff`, a
`default-src 'none'` policy and a generated filename; a repeat request with
`If-None-Match` gets `304`.

Attaching one publishes `encomenda:actualizada` with `motivo: "prova"`.

## Reports

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/reports/summary` | ADMIN, OPERADOR |
| GET | `/api/reports/orders.csv` | ADMIN, OPERADOR |

Both take `from` and `to` as Luanda dates (`YYYY-MM-DD`), inclusive on both ends. A
window that runs backwards, contains a date that does not exist, or spans more than
366 days answers `400`. The boundaries are Luanda midnights, so "1 to 30 September"
means those days here rather than in UTC.

`summary` is one response with every aggregate the screen shows: totals, a per-day
series of created and delivered, a breakdown by status, per-driver performance, and
the top destination municipalities. They are fetched together on purpose — split
across endpoints, a client could display numbers that disagree because they were
read a second apart.

Two fields are deliberately nullable. `successRate` is `null` when nothing in the
window has finished, because 0% would claim every delivery failed; and delivery time
is reported as a **median**, since one parcel that sat in the warehouse over a
weekend drags a mean far enough to make it useless for planning.

`orders.csv` returns the same window as a file: `;` separated with a byte-order mark,
because Excel in this locale reads a comma-separated file as one column. Any field
starting with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet
cannot execute a value that arrived from a form. The response is capped at 50 000
rows and carries the count in `X-Row-Count`. Every export is recorded in the audit
trail with the window and the number of rows, because it takes customer names and
phone numbers out of the system.

## Map

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/map/operation` | any, narrowed by role |
| PATCH | `/api/orders/:id/coordinates` | ADMIN, OPERADOR |

`operation` returns everything one map draws: `items`, the open orders that have a
destination point; `origins`, the distinct pickup points they leave from; `drivers`,
where the fleet was last seen; and `withoutCoordinates`, the open orders it **cannot**
draw. That last list is the
reason this is not the order list with a filter — a map silently omitting three
parcels is worse than a map that says so, because the dispatcher counts markers and
believes them. It also carries `center` (Luanda), so a map with nothing to show does
not open on the middle of the Atlantic and look broken.

Only open orders are returned. A parcel delivered last month is noise covering the
one being looked for. The scope comes from the session: a driver gets the parcel he
is carrying, a customer the orders placed for them, an operator the company. A
driver account with no driver row gets an empty map, never the company's.

`drivers` only carries positions newer than `positionFreshnessMinutes` (15). A point
from two hours ago drawn like a current one is a lie the map tells with a straight
face: by then the courier may have finished, gone home, or closed the page that was
reporting. Each entry carries `reportedAt` and, when the phone gave one,
`accuracyMeters` — a point with a two-kilometre radius is not a location, and the
interface says which kind it is showing. Customers get no positions at all: where the
courier is standing is not part of following a parcel. This list exists so a page that
just opened is not blank until somebody moves; from there the socket carries the
changes.

`PATCH /api/orders/:id/coordinates` takes `{ latitude, longitude }` and moves the
destination point only — the written address is untouched, because "quiosque 12, em
frente ao Talatona Imperial" is how somebody actually finds the place and a map click
cannot improve on it. Coordinates are set by hand rather than geocoded for the same
reason: most addresses here are a description and a landmark, which no geocoder
resolves.

Two refusals are worth knowing. A pair that would be inside Angola if the numbers
were exchanged answers `400` naming the mistake and suggesting the corrected pair,
because `13.23, -8.83` is a valid point in the Atlantic and looks plausible on a
zoomed-in map. And a finished order answers `409`: where a delivery went is history,
which is why addresses are snapshots on the row rather than a foreign key. Every
change is recorded in the audit trail with the point.

## Customers

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/customers` | ADMIN, OPERADOR |
| POST | `/api/customers` | ADMIN, OPERADOR |
| GET | `/api/customers/:id` | ADMIN, OPERADOR |

Phone numbers are normalised to `+244XXXXXXXXX` on the way in. A second customer
with the same number in the same company answers `409`.

## Drivers

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/drivers` | ADMIN, OPERADOR |
| GET | `/api/drivers/available` | ADMIN, OPERADOR |
| POST | `/api/drivers` | ADMIN, OPERADOR |
| PATCH | `/api/drivers/:id` | ADMIN, OPERADOR |

`PATCH` changes availability. Taking a driver off duty while he is holding a
parcel answers `409`: the parcel would be left with nobody responsible for it.

## Realtime

Socket.IO on `/realtime`, on the same server and the same port as the API.

The browser connects to its own origin, like every other call the interface makes, so
whatever serves the frontend must forward `/realtime` to this process **with the
WebSocket upgrade intact**. In development that is the Vite proxy with `ws: true`. A
host that rewrites HTTP but drops upgrades leaves the client working over long-polling
— which functions, badly, and hides the misconfiguration. This is settled properly in
phase 9, where deployment is the subject.

The handshake carries no token of its own: it is authenticated by the session cookie,
resolved by the same function the HTTP middleware uses. A socket cannot become a
second, weaker way in. A cookie that is missing, expired or revoked fails the
handshake with `UNAUTHENTICATED`, and a driver or customer account whose record cannot
be resolved fails with `SEM_AMBITO` — an unresolvable scope gets no feed rather than
the company's.

Nothing subscribes. Rooms are joined once, at connect, from the session: operators to
their company's operations room, a driver to a room named after his own driver record,
a customer to theirs. There is no room that spans two companies and no message a client
can send to ask for one, because a subscribe message is a request to name somebody
else's room.

Server to client:

| Event | Reaches | Carries |
|-------|---------|---------|
| `pronto` | the socket that just connected | `role`, `companyName` |
| `encomenda:actualizada` | operators, plus the assigned driver and the customer | `motivo` (`criada`, `atribuida`, `estado`) and the full order |
| `motorista:posicao` | operators only | driver, point, `accuracyMeters`, the parcel being carried, `reportedAt` |
| `aviso` | whoever must act: the driver assigned, or the operators | `tipo`, `mensagem`, `orderId` |
| `sessao:terminada` | a socket whose session was revoked | — |

Client to server, one message:

| Event | From | Answer |
|-------|------|--------|
| `posicao` | MOTORISTA only | ack `{ ok }`, or `{ ok: false, message }` |

`posicao` takes `{ latitude, longitude, accuracyMeters? }`. The driver id is taken from
the session and never from the message, so a socket cannot report somebody else's
whereabouts. The point is validated exactly like a typed coordinate, including the
swapped pair a phone will happily report if something in between exchanges them. A
second point within three seconds is dropped with `{ ok: true, ignored: true }` rather
than refused: a phone reporting eagerly is not a mistake worth telling a driver about,
though the database write it would cause is worth avoiding. Anyone who is not a driver
is refused outright.

Only the last position of each driver is kept, upserted. No trail: a point every ten
seconds is some nine thousand rows per driver per day, and nothing in the product
answers a question that needs the history. When one appears it gets its own table,
sampled for that question, rather than inheriting whatever rate a phone happened to
report at.

Live sockets are re-checked against the database every two minutes and dropped if the
session was revoked. Logging out in one tab closes the socket in the others, which is
the whole reason sessions live in a table instead of a self-contained token.

A publish is fire-and-forget on purpose: a delivery that was recorded must never fail
because a browser could not be told about it. The interface treats the socket the same
way — as a convenience over polling, never a source of truth. Every screen still loads
over HTTP and refetches on reconnect, because a socket that was down for a minute has
missed events and cannot know which.

## Planned

Public parcel tracking by code, for a customer who does not have an account.
