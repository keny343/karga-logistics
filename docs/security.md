# Security

What is implemented is described in the present tense. Items belonging to later
phases say so, so this document cannot be mistaken for a claim.

## In place now

**Configuration refuses to be wrong.** The process validates its environment at
boot and throws if `DATABASE_URL` is missing or a value is malformed. A server that
starts without a database only fails later, on a user's request.

**No stack traces to clients.** The error handler logs the stack and sends a code
and a message. In production an unexpected error's message is replaced with a
generic one, so an internal detail cannot escape through a message string.

**Secrets never reach the logs.** The logger drops values under keys matching
`password`, `senha`, `token`, `authorization`, `cookie`, `secret`, `apiKey` at any
nesting depth. Logging a credential once is enough to leak it, and logs travel
further than code.

**Explicit CORS.** An allowlist of origins, credentials enabled, and origins
trimmed of trailing slashes so a stray character in an environment variable cannot
produce an invalid header. Requests from an origin outside the list are refused.

**Security headers.** `helmet` with its defaults, and `x-powered-by` disabled.

**Rate limiting.** 300 requests per minute per IP on `/api`, with `trust proxy`
set to exactly one hop so the limiter keys on the real caller behind Render or
Vercel without letting a client forge the chain.

**Bounded request bodies.** 256 kB on JSON and form bodies, answered with
`PAYLOAD_TOO_LARGE` rather than an unhandled error.

**Request ids are not echoed blindly.** An inbound `X-Request-Id` is adopted only
if it matches `[A-Za-z0-9._-]{8,64}`; anything else is replaced with a generated
one, so a caller cannot inject content into a log line or a response header.

**Parameterised SQL only.** Every query goes through `pg` with positional
parameters. No string concatenation builds SQL anywhere in the repository.

## Tenancy

`company_id` on every business table, filtered in the repository layer rather than
in a controller, so a new endpoint cannot forget it. The company comes from the
authenticated session and never from the request body or query string.

A resource that belongs to another company answers **404, not 403**. `403` confirms
that the id exists, which is itself information a tenant should not have.

## Authentication

**Passwords hashed with bcrypt at cost 12.** The test suite drops to the minimum
cost: it hashes dozens of passwords per run, and what those tests check is the
logic around the hash, not the cost factor.

**Server-side sessions, not JWTs.** The cookie carries 32 bytes of randomness,
base64url encoded. Only its SHA-256 hash is stored, so a database dump does not
hand over live sessions — and because the token is high-entropy rather than a
guessable password, a fast hash is the right choice here. Logging out revokes the
row, so the cookie stops working immediately.

**Cookie flags.** `httpOnly` so no script can read it, `SameSite=Lax` so a
cross-site form cannot replay it while ordinary navigation still works, `Secure`
everywhere except local development, where there is no HTTPS to attach it to,
`path=/`, and a seven-day expiry.

**Identical answer for a wrong password and an unknown account.** Telling them
apart hands an attacker a list of valid emails. When an account does not exist, a
throwaway hash is still computed, so the response does not come back measurably
faster.

**Login throttling in the database.** Five failures on one account or twenty from
one address within fifteen minutes answer `429`, including for the correct
password. A counter in process memory would reset on every deploy and would not be
shared between instances. On top of that, a rate limiter in front of the endpoint
stops a flood before it reaches bcrypt, which is deliberately expensive.

**The authorization chain, in order.** Authentication (`requerAutenticacao`), then
role (`requerPapel`), then company (`empresaDe`, always from the session), then
ownership of the resource (in the service: a driver may only move the parcels
assigned to him). Each step is separate so a new endpoint cannot get half of it,
and the route guards in the interface are convenience only — the API checks
independently.

## Exports

**A CSV is code until proven otherwise.** Excel runs a cell that begins with `=`,
`+`, `-` or `@`, so every exported field starting with one of those is prefixed with
an apostrophe. The names and addresses in an export were typed into a form by
somebody other than the person who opens the file, and `=HYPERLINK(...)` in a
customer name is an attack on the operator, not a typo.

**Bounded windows and bounded rows.** The report range cannot exceed 366 days and
the export stops at 50 000 rows, so neither can be turned into a table scan that
holds a connection open.

**The filename is built from validated dates only.** Nothing from a request body
reaches the `Content-Disposition` header, where a quote or a newline would let a
caller write header content.

**Every export is audited** with the window and the row count. Data leaving the
system is exactly what an audit trail is for.

## The map

**Third-party tiles see the viewport, not the data.** Tiles come from
OpenStreetMap, so the browser tells `tile.openstreetmap.org` which area is being
looked at. It never sends order codes, customer names or coordinates — those come
from this API and are drawn locally on top. The attribution the licence requires is
part of the map and is not removed.

**A popup is HTML, so every value going into one is escaped.** Leaflet popups live
outside React's tree, which means React's escaping does not apply. Customer names,
addresses and municipalities are escaped before they are interpolated, because they
were typed into a form.

**The map's scope is the session's scope.** It is the same resolution the order list
uses, in one place so the two cannot disagree: a driver sees the parcel he carries, a
customer the orders placed for them. A driver account with no driver row gets an
empty map rather than the company's — a missing link fails closed.

**A finished order's destination cannot be moved.** Coordinates are part of the
address snapshot on the row; letting a map click change them after delivery would
rewrite where a parcel actually went. Every accepted change is audited with the
point.

## Realtime

**The socket is authenticated by the session, not by a token of its own.** The
handshake reads the same cookie and calls the same `resolverSessao` the HTTP
middleware calls. Adding a second credential path — a query-string token, a
"socket key" — would mean a second thing to get wrong, and the weaker of the two is
the one an attacker uses.

**Narrowing happens at subscribe time, not in the payload.** Every room name begins
with the company id, and a client joins its rooms once, at connect, from its own
session. There is no message a client can send to join a room, because that message
is a request to name somebody else's. Filtering a payload after it arrives in the
wrong browser is not filtering: it has already leaked.

**A driver reports only his own position.** The driver id comes from the session; the
message carries the point and nothing else. A socket cannot place a colleague
somewhere he is not.

**Positions reach the people dispatching and nobody else.** Not other drivers, whose
whereabouts are none of each other's business, and not customers — following a parcel
is a narrower thing than watching a person move, and it will get its own payload if it
is ever built.

**Sharing is the driver's decision, every time.** Nothing reports automatically, the
page says what it costs before he agrees, and the interface never claims the office can
see him until the server has acknowledged a point. Telling a courier he is visible when
he is not is the failure in this feature that leaves somebody waiting on a roadside.

**A revoked session drops its sockets.** Live connections are re-checked every two
minutes and disconnected if the session is gone, so logging out — or an account being
retired — takes effect on the socket and not only on the next request.

**Incoming points are validated like any other input.** Type, finiteness, and inside
Angola, including the swapped-pair case. Ingestion is rate limited per socket in the
server, so a compromised or buggy client cannot turn a phone into a write loop.

## Phase 7 (uploads)

Proof-of-delivery photos will be validated on MIME type, extension, size and
magic bytes, stored outside the application directory with generated names, and
served without any execution path. A filename from a client is never trusted as a
path.

## Auditing

`audit_logs` records sensitive actions with actor, action, resource, request id and
IP. It never stores passwords, tokens or session identifiers. Rows are append-only
and survive the deletion of the account that caused them.

Recorded today: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `ORDER_CREATED`,
`ORDER_ASSIGNED`, `DELIVERY_PICKED_UP`, `DELIVERY_STARTED`, `DELIVERY_COMPLETED`,
`DELIVERY_FAILED`, `ORDER_CANCELLED`, `ORDER_RETURNED`, `CUSTOMER_CREATED`,
`DRIVER_CREATED`, `DRIVER_STATUS_CHANGED`, `REPORT_EXPORTED`,
`ORDER_COORDINATES_SET`.

A failed audit write never fails the request: by then the action has already
succeeded, and refusing it afterwards would be worse than a missing row. The
failure is logged as an error instead.

Separately from the audit trail, `order_status_history` keeps every accepted
transition with the state it came from, the actor and any note — so the path an
order took is reconstructable even if a later bug corrupts `orders.status`.

## Reporting

If you find a vulnerability in this repository, open an issue without a working
exploit and I will fix it.
