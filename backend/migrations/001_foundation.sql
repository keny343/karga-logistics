-- Foundation: tenancy backbone and the tables every later phase hangs off.
-- Coordinates live in plain numeric columns. PostGIS is the eventual home for
-- them, but nothing here needs a spatial index yet and a dependency that is not
-- used is a dependency that breaks the build for nothing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')
);

-- Roles are a fixed, small set the code switches on, so they belong in the type
-- system rather than in a table someone can edit into a state the code cannot
-- handle.
CREATE TYPE user_role AS ENUM ('ADMIN', 'OPERADOR', 'MOTORISTA', 'CLIENTE');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name           text NOT NULL,
  email          text NOT NULL,
  phone          text,
  password_hash  text NOT NULL,
  role           user_role NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Email is unique per company, not globally: the same person may work for two
  -- carriers, and one carrier must not learn who exists at another.
  CONSTRAINT users_email_por_empresa UNIQUE (company_id, email),
  CONSTRAINT users_email_format CHECK (position('@' in email) > 1)
);

CREATE INDEX users_company_role_idx ON users (company_id, role) WHERE is_active;

-- Audit rows outlive the user who caused them, so the reference is nullable and
-- the actor's identity is copied in as text. Deleting a user must never rewrite
-- history.
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  company_id    uuid REFERENCES companies(id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label   text NOT NULL,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_company_created_idx ON audit_logs (company_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id);
