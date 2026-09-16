# API

Base path `/api`. All bodies are JSON. All timestamps are ISO 8601 in UTC.

## The error contract

Every failure, from any endpoint, has this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos.",
    "requestId": "0f4d2a1e-…",
    "details": [{ "field": "phone", "message": "Formato +244 esperado." }]
  }
}
```

`details` appears only for validation failures. `requestId` matches the
`X-Request-Id` response header and the log lines for that request, so a user can
quote it and the cause can be found.

Codes are part of the contract — clients switch on them:

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Body, params or query rejected |
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Authenticated, but the role does not allow it |
| `NOT_FOUND` | 404 | No such resource — also returned for another company's resource |
| `INVALID_STATE_TRANSITION` | 409 | The order cannot move that way |
| `CONFLICT` | 409 | Would violate a uniqueness rule |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 256 kB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Upload type not accepted |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected — details are in the logs, not the response |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is down |

## Available now (phase 1)

### `GET /health`

Liveness. Touches no dependency, so it stays truthful when the database is down.
Registered before CORS, so an origin misconfiguration cannot hide the service from
its platform.

```json
{ "status": "ok", "service": "karga-api", "uptimeSeconds": 145 }
```

### `GET /ready`

Readiness. Checks the database with a two-second bound. `200` when serving is
possible, `503` when it is not.

```json
{ "ready": true, "checks": { "database": { "ok": true, "latencyMs": 4 } } }
```

### `GET /api`

Service identity and the resources currently mounted.

## Planned

Documented here as they land, and specified in OpenAPI once the shapes stop
moving. The intended surface:

```
POST   /api/auth/login             POST   /api/auth/logout
GET    /api/auth/me

GET    /api/orders                 POST   /api/orders
GET    /api/orders/:id             PATCH  /api/orders/:id
POST   /api/orders/:id/assign      POST   /api/orders/:id/status

GET    /api/drivers                POST   /api/drivers
GET    /api/customers              POST   /api/customers

GET    /api/deliveries             GET    /api/deliveries/:id
POST   /api/deliveries/:id/location
POST   /api/deliveries/:id/proof

GET    /api/tracking/:code         (public, no session)

GET    /api/notifications
GET    /api/reports/…
```

Two of these carry a rule worth stating in advance. `POST /api/orders/:id/status`
is the only way an order's state changes, and it refuses anything the state machine
does not allow. `POST /api/deliveries/:id/proof` is idempotent on a client-supplied
key, because a driver on a weak connection will send it twice and a delivery must
not be completed twice.
