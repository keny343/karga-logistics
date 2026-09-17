# Architecture

## Shape

A modular monolith. One deployable API process, one web app, one database.
Splitting a carrier's dispatch operation into services would introduce network
failures between steps that are naturally a single transaction — assigning a
driver and appending the history entry, for example.

```
browser ──> Vite/React SPA ──> Express API ──> PostgreSQL
                                    │
                                    └── Socket.IO (same process, phase 6)
```

Socket.IO shares the HTTP server rather than running beside it. Realtime events
originate from the same code that writes the state change, so a client cannot be
told about a transition that was not persisted.

## Layers

Requests flow one way, and each layer is allowed to know only the next:

```
route ──> controller ──> service ──> repository ──> database
```

- **route** — path, method, middleware chain. No logic.
- **controller** — validates input, calls one service, shapes the response.
- **service** — the rules: what a transition allows, who may assign whom. This is
  where the tests concentrate, because this is where being wrong costs money.
- **repository** — SQL. Every query that touches a business table takes a
  `company_id` and filters on it.

Beside them sits **domain**, which has no dependencies at all: the order state
machine is a transition table and a function that consults it. It knows nothing
about Express or `pg`, which is why every ordered pair of statuses can be tested
without a database.

The direction matters: a service never reads `req`, so its rules are testable
without an HTTP layer, and a repository never decides policy.

## Cross-cutting middleware

Order is deliberate:

1. **request context** — assigns a request id (or adopts a safe inbound one),
   echoes it as `X-Request-Id`, and logs method, path, status and duration when
   the response finishes.
2. **probes** — `/health` and `/ready`, mounted here so no later middleware can
   make the service look dead.
3. **helmet**, then **CORS** with an explicit origin list.
4. **body parsers**, capped at 256 kB.
5. **rate limiting** on `/api`.
6. **routes**.
7. **not-found**, then the **error handler**, which is the only place that turns a
   thrown error into a response.

## Errors

Nothing constructs an error response by hand. Code throws `AppError` with a code
from a closed list, and the handler renders it:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "requestId": "…" } }
```

Zod failures become `VALIDATION_ERROR` with a `details` array of field messages.
Malformed JSON is caught too, so an API that promises JSON never answers with
Express's HTML error page. Stack traces go to the log and never to the client; in
production an unexpected error's message is replaced entirely.

## Observability

Logs are JSON lines, one event per line, warnings and errors on stderr because
platforms classify streams rather than payloads. A redaction list drops
`password`, `token`, `authorization`, `cookie` and friends at any nesting depth,
so an accidental log of a request body cannot leak a credential.

`/health` answers from the process alone. `/ready` checks the database with a
bounded timeout — a probe that hangs is worse than one that fails, because the
platform keeps sending traffic while it waits.

## Multi-tenancy

`company_id` on every business table, filtered in the repository. The API never
takes a company from the client: it comes from the authenticated session. A
resource belonging to another company answers `404`, not `403`, so an id cannot be
probed for existence across tenants.

## The state machine

`src/domain/orderStatus.ts` is the only place that says which move is legal. The
service consults it before writing, the database repeats the parts it can express
as `CHECK` constraints, and the API returns the allowed moves with every order so
the interface renders buttons from the domain rather than from a hardcoded list.
Three enforcement points for one rule, because the cost of an illegal state here
is a parcel nobody is responsible for.

An order is locked with `SELECT … FOR UPDATE` for the duration of a transition, so
two operators clicking at once cannot both read `PRONTO` and both write.

## Aggregates

Reporting has a repository and a controller, and no service: there are no rules to
enforce, only counting, and a layer that forwards a call unchanged is a layer that
hides where the work happens. Every aggregate counts in the database rather than
loading rows into Node — a busy month is tens of thousands of orders and the answer
is a handful of numbers.

The only decision the reporting controller makes is one SQL cannot: with nothing
finished in the window, the success rate is `null` rather than zero, because those
two statements mean very different things to whoever reads the screen.

## Frontend

```
main ──> SessionProvider ──> ToastProvider ──> router ──> AppLayout ──> page
```

- **`ui/`** — the component library. Nothing outside it declares a colour, a
  radius or a font size; those live in `styles/tokens.css`.
- **`api/client.ts`** — every request, typed, sending credentials, raising
  `ApiError` with the server's code and message. No component calls `fetch`.
- **`hooks/useResource`** — one place that owns loading, empty, error and
  refreshing. A screen that fetches gets all five states by construction rather
  than by remembering.
- **`auth/SessionContext`** — asks `/api/auth/me` once at boot; the router waits
  for that answer instead of flashing the login screen at a signed-in user.
- **`domain/orderStatus.ts`** — status labels and their semantic tone, so the same
  status is never green on one screen and blue on another.
- **charts** — `ui/BarChart` and `ui/Distribution` are shared by the dashboard and
  the reports screen. They draw in CSS: a charting library would add a hundred
  kilobytes to render a few dozen rectangles. The bars are `aria-hidden` and the
  same numbers are emitted as a visually hidden table, which is the honest way to
  make a chart readable by a screen reader.

Route guards are convenience. The interface hides what a role may not do; the API
refuses it regardless.

## Testing strategy

Tests go where an error is expensive:

- **state transitions** — every legal move, and the illegal ones that must be
  refused;
- **authorization** — no session, wrong role, another company's resource;
- **the error contract** — the envelope, the request id, no leaked stack;
- **idempotency** — a repeated completion or proof must not duplicate.

Not tested: framework behaviour, getters, and rendering that asserts nothing about
state.
