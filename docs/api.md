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
the history and is how a failed delivery gets explained.

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

## Planned

Reports and exports (phase 4), addresses and the operational map (phase 5),
Socket.IO events (phase 6), proof of delivery uploads (phase 7).
