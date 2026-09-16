# Security

What is implemented in phase 1 is marked as such. Items belonging to later phases
say so, so this document cannot be mistaken for a claim.

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

## Phase 2 (authentication)

Planned, and not yet present: password hashing with bcrypt at cost 12, sessions in
`httpOnly`, `SameSite=Lax`, `Secure` cookies, per-account and per-IP login
throttling, and an authorization chain that checks, in order, authentication →
role → company → resource ownership.

## Phase 7 (uploads)

Proof-of-delivery photos will be validated on MIME type, extension, size and
magic bytes, stored outside the application directory with generated names, and
served without any execution path. A filename from a client is never trusted as a
path.

## Auditing

`audit_logs` records sensitive actions with actor, action, resource, request id and
IP. It never stores passwords, tokens or session identifiers. Rows are append-only
and survive the deletion of the account that caused them.

## Reporting

If you find a vulnerability in this repository, open an issue without a working
exploit and I will fix it.
