-- Customers, drivers, orders and the history of every state change.

CREATE TYPE order_status AS ENUM (
  'CRIADO',
  'CONFIRMADO',
  'PREPARANDO',
  'PRONTO',
  'ATRIBUIDO',
  'RECOLHIDO',
  'EM_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
  'FALHA_ENTREGA',
  'DEVOLVIDO'
);

CREATE TYPE driver_status AS ENUM ('DISPONIVEL', 'EM_ENTREGA', 'INDISPONIVEL', 'OFFLINE');

CREATE TYPE vehicle_type AS ENUM ('MOTA', 'CARRO', 'CARRINHA');

-- Addresses are columns on the row that owns them, not a shared table.
-- An order's destination is a snapshot: if the customer later moves, a delivery
-- from last month must still say where it actually went. A foreign key to an
-- editable address would let a customer update rewrite history.
-- Angolan addresses often have no postal format, so `description` is the free-form
-- part people actually use and only province/municipality are structured.
CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- Set when the customer also has a portal account, so a CLIENTE session can be
  -- narrowed to their own orders without matching on something as weak as an email.
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  name              text NOT NULL,
  phone             text NOT NULL,
  email             text,
  addr_description  text NOT NULL,
  addr_province     text NOT NULL DEFAULT 'Luanda',
  addr_municipality text NOT NULL,
  addr_locality     text,
  addr_reference    text,
  addr_latitude     numeric(9, 6),
  addr_longitude    numeric(9, 6),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_phone_format CHECK (phone ~ '^\+244[0-9]{9}$'),
  CONSTRAINT customers_lat_range CHECK (addr_latitude IS NULL OR addr_latitude BETWEEN -90 AND 90),
  CONSTRAINT customers_lng_range CHECK (addr_longitude IS NULL OR addr_longitude BETWEEN -180 AND 180)
);

CREATE INDEX customers_company_name_idx ON customers (company_id, lower(name));
CREATE UNIQUE INDEX customers_user_idx ON customers (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX customers_company_phone_idx ON customers (company_id, phone) WHERE is_active;

CREATE TABLE drivers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- A driver may or may not have an account to log in with; the operation exists
  -- either way.
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  name           text NOT NULL,
  phone          text NOT NULL,
  document_id    text,
  status         driver_status NOT NULL DEFAULT 'OFFLINE',
  vehicle_type   vehicle_type,
  vehicle_plate  text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drivers_phone_format CHECK (phone ~ '^\+244[0-9]{9}$'),
  CONSTRAINT drivers_user_unico UNIQUE (user_id)
);

CREATE INDEX drivers_company_status_idx ON drivers (company_id, status) WHERE is_active;

-- Codes come from one sequence for the whole installation. Per-company numbering
-- would produce two KRG-000001, and a public tracking link has nothing else to
-- disambiguate them with.
CREATE SEQUENCE order_code_seq START 1;

CREATE TABLE orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code                 text NOT NULL UNIQUE,
  customer_id          uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  driver_id            uuid REFERENCES drivers(id) ON DELETE RESTRICT,
  status               order_status NOT NULL DEFAULT 'CRIADO',
  description          text NOT NULL,
  -- Integers only: grams and cêntimos. A float that holds money loses a cêntimo
  -- eventually, and the loss is found when a total disagrees.
  weight_grams         integer NOT NULL DEFAULT 0,
  value_cents          bigint NOT NULL DEFAULT 0,
  origin_description   text NOT NULL,
  origin_province      text NOT NULL DEFAULT 'Luanda',
  origin_municipality  text NOT NULL,
  origin_locality      text,
  origin_reference     text,
  origin_latitude      numeric(9, 6),
  origin_longitude     numeric(9, 6),
  dest_description     text NOT NULL,
  dest_province        text NOT NULL DEFAULT 'Luanda',
  dest_municipality    text NOT NULL,
  dest_locality        text,
  dest_reference       text,
  dest_latitude        numeric(9, 6),
  dest_longitude       numeric(9, 6),
  expected_delivery_at timestamptz,
  completed_at         timestamptz,
  notes                text,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_weight_positivo CHECK (weight_grams >= 0),
  CONSTRAINT orders_valor_positivo CHECK (value_cents >= 0),
  -- The database refuses an assignment-shaped hole even if a bug in the API asks
  -- for one: these states cannot exist without a driver.
  CONSTRAINT orders_motorista_quando_necessario CHECK (
    driver_id IS NOT NULL
    OR status NOT IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'ENTREGUE')
  )
);

CREATE INDEX orders_company_status_idx ON orders (company_id, status);
CREATE INDEX orders_company_created_idx ON orders (company_id, created_at DESC);
CREATE INDEX orders_company_driver_idx ON orders (company_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX orders_company_customer_idx ON orders (company_id, customer_id);
-- Only open orders can be late, so the index carries only those rows.
CREATE INDEX orders_atrasadas_idx ON orders (company_id, expected_delivery_at)
  WHERE expected_delivery_at IS NOT NULL
    AND status NOT IN ('ENTREGUE', 'CANCELADO', 'DEVOLVIDO');

-- Append-only. Every accepted transition writes one row, including the state it
-- came from, so the path an order took is reconstructable even if a later bug
-- corrupts orders.status.
CREATE TABLE order_status_history (
  id              bigserial PRIMARY KEY,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status          order_status NOT NULL,
  previous_status order_status,
  changed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label     text NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);
