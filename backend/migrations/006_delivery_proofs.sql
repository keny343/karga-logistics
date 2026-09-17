-- What the driver showed for a delivery: a photo at the door, a signature, or both.
--
-- The bytes live in this table rather than in a bucket. The reason is not that a
-- bucket would be wrong - at volume it is the right answer - but that an object store
-- adds credentials, a second failure mode and a second thing to back up, and the
-- carrier this is built for delivers in the tens per day. Photos are downscaled in the
-- browser before they are sent, so a row is a few hundred kilobytes: a year of
-- deliveries is measured in gigabytes, which Postgres carries without complaint.
--
-- The exit is deliberately short. Nothing outside `repositories/proofs.repository.ts`
-- knows where the bytes are, so moving them to S3 means adding a driver behind that
-- module and a migration that streams the column out - not touching a controller.
-- The line at which it is worth doing: when this table passes a few gigabytes, or when
-- backups start being planned around it.
--
-- Proofs are append-only. There is no delete endpoint and no update: evidence that can
-- be revised is not evidence. A wrong photo is answered by a second photo.
CREATE TYPE proof_kind AS ENUM ('FOTO', 'ASSINATURA');

CREATE TABLE delivery_proofs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind          proof_kind NOT NULL,

  -- The driver who was there. Null when an operator attached it at the counter, which
  -- happens and should be visible rather than disguised as the driver's capture.
  driver_id     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  -- Who uploaded it, kept even after the account is gone: the row is evidence, and
  -- evidence that loses its author is worth less.
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  uploader_label text NOT NULL,

  mime_type     text NOT NULL,
  byte_size     integer NOT NULL,
  -- The hash the server computed over the bytes it stored. It answers "is this the same
  -- file that was uploaded?" without needing to trust anything the client said, and it
  -- lets a duplicate upload be recognised instead of stored twice.
  sha256        text NOT NULL,
  bytes         bytea NOT NULL,

  -- Where the phone said it was when the picture was taken, when it was willing to say.
  -- Null is a normal answer: indoors, at a counter, a phone often has no fix, and a
  -- delivery without coordinates is still a delivery.
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  accuracy_meters integer,

  -- Two clocks, on purpose. `captured_at` is what the device claimed; `created_at` is
  -- when this server accepted the bytes. A phone with a wrong clock, or a driver who
  -- uploads once he is back in coverage, makes them differ - and the interface shows
  -- the difference rather than picking one and pretending it is the truth.
  captured_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_proofs_size CHECK (byte_size > 0 AND byte_size <= 5 * 1024 * 1024),
  CONSTRAINT delivery_proofs_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT delivery_proofs_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- A coordinate is a pair or it is nothing. Half of one drawn on a map is a lie.
  CONSTRAINT delivery_proofs_point CHECK (
    (latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  ),
  CONSTRAINT delivery_proofs_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT delivery_proofs_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT delivery_proofs_accuracy CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

-- The same file sent twice - a driver tapping upload again on a bad connection - is one
-- proof, not two. The unique index makes that the database's answer rather than a race
-- between two requests.
CREATE UNIQUE INDEX delivery_proofs_unicas ON delivery_proofs (order_id, sha256);

-- Every read starts from one order, in oldest-first order, and never selects `bytes`
-- unless it is serving the file itself.
CREATE INDEX delivery_proofs_order_idx ON delivery_proofs (order_id, created_at);
