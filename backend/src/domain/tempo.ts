/**
 * The operational day.
 *
 * Timestamps are stored in UTC, but "orders today" is a question about a working
 * day in Luanda. Between 23:00 and midnight local time the two disagree, and an
 * operator reading a dashboard that says zero while nine parcels went out an hour
 * ago has no reason to trust the rest of it.
 *
 * Angola has never used daylight saving, so this offset is stable; the named zone
 * is used anyway rather than a hardcoded `+01`, because that is the fact being
 * expressed.
 */
export const FUSO_OPERACIONAL = 'Africa/Luanda';

/** Local midnight today, as a `timestamptz` comparable with a stored column. */
export const INICIO_DE_HOJE = `date_trunc('day', now() AT TIME ZONE '${FUSO_OPERACIONAL}') AT TIME ZONE '${FUSO_OPERACIONAL}'`;

/** Local midnight today, as a naive `timestamp`, for generating day series. */
export const HOJE_LOCAL = `date_trunc('day', now() AT TIME ZONE '${FUSO_OPERACIONAL}')`;

/** Turns a naive local `timestamp` expression into the instant it names. */
export const comoInstante = (expressao: string) =>
  `(${expressao}) AT TIME ZONE '${FUSO_OPERACIONAL}'`;
