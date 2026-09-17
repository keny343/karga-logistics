-- Where each driver was last seen.
--
-- One row per driver, upserted. A trail is deliberately not kept: a position every
-- ten seconds is around nine thousand rows per driver per day, and nothing in the
-- product answers a question that needs the history. When one appears - a dispute
-- about a route, say - it gets its own table, sampled at a rate that matches the
-- question, rather than being an accident of how often a phone reported in.
--
-- The position is a claim made by a phone, not a measurement this system took. That
-- is why `accuracy_meters` is stored beside it and `reported_at` is the moment the
-- server accepted it: a point with a 2 km radius must be readable as such rather
-- than drawn like a certainty.
CREATE TABLE driver_positions (
  driver_id       uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  latitude        numeric(9, 6) NOT NULL,
  longitude       numeric(9, 6) NOT NULL,
  accuracy_meters integer,
  -- The order the driver was carrying when the point arrived, when there was one.
  -- Kept so a position can be read next to the delivery it belonged to.
  order_id        uuid REFERENCES orders(id) ON DELETE SET NULL,
  reported_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_positions_lat_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT driver_positions_lng_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT driver_positions_accuracy CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

-- The map asks for one company's recent positions, which is the only read there is.
CREATE INDEX driver_positions_company_idx ON driver_positions (company_id, reported_at DESC);
