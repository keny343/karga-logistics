import type { PoolClient } from 'pg';
import { query } from '../config/database.js';
import type { TipoImagem } from '../domain/imagem.js';

/**
 * Where the proof bytes live, and the only module that knows.
 *
 * Today they are a `bytea` column; see `migrations/006_delivery_proofs.sql` for why, and
 * for the line at which that should change. The point of keeping every read and write
 * behind this file is that moving them to object storage is a change to one module and a
 * backfill, rather than a change to every controller that ever touched an image.
 *
 * The distinction the rest of the code relies on: `daEncomenda` never selects `bytes`,
 * because a list of six proofs is metadata and a request for one file is a download.
 * Loading megabytes to render a row of thumbnails is how an endpoint becomes slow for a
 * reason nobody can see in the SQL.
 */

export type Tipo = 'FOTO' | 'ASSINATURA';

export interface NovaProva {
  readonly companyId: string;
  readonly orderId: string;
  readonly kind: Tipo;
  readonly driverId?: string;
  readonly uploadedBy: string;
  readonly uploaderLabel: string;
  readonly mimeType: TipoImagem;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracyMeters?: number;
  readonly capturedAt?: Date;
}

export interface ProvaLinha {
  id: string;
  order_id: string;
  kind: Tipo;
  driver_id: string | null;
  driver_name: string | null;
  uploader_label: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  latitude: string | null;
  longitude: string | null;
  accuracy_meters: number | null;
  captured_at: Date | null;
  created_at: Date;
}

const CAMPOS = `p.id, p.order_id, p.kind, p.driver_id, d.name AS driver_name, p.uploader_label,
                p.mime_type, p.byte_size, p.sha256, p.latitude, p.longitude,
                p.accuracy_meters, p.captured_at, p.created_at`;

/**
 * Stores the proof, or returns the one already there.
 *
 * A driver on a bad connection taps upload, sees nothing happen, and taps again. Both
 * requests carry identical bytes, so the second collides with the unique index on
 * `(order_id, sha256)` and is answered with the existing row instead of an error: from
 * where he is standing the upload worked, which is the truth, and the order ends up with
 * one proof rather than two of the same photograph.
 */
export const registar = async (dados: NovaProva): Promise<ProvaLinha> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO delivery_proofs
       (company_id, order_id, kind, driver_id, uploaded_by, uploader_label,
        mime_type, byte_size, sha256, bytes,
        latitude, longitude, accuracy_meters, captured_at)
     VALUES ($1, $2, $3::proof_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (order_id, sha256) DO NOTHING
     RETURNING id`,
    [
      dados.companyId,
      dados.orderId,
      dados.kind,
      dados.driverId ?? null,
      dados.uploadedBy,
      dados.uploaderLabel,
      dados.mimeType,
      dados.bytes.length,
      dados.sha256,
      dados.bytes,
      dados.latitude ?? null,
      dados.longitude ?? null,
      dados.accuracyMeters ?? null,
      dados.capturedAt ?? null,
    ],
  );

  const id = rows[0]?.id;
  const linha =
    id === undefined
      ? await porHash(dados.companyId, dados.orderId, dados.sha256)
      : await porId(dados.companyId, id);

  if (linha === null) throw new Error('prova não gravada');
  return linha;
};

export const porId = async (companyId: string, id: string): Promise<ProvaLinha | null> => {
  const { rows } = await query<ProvaLinha>(
    `SELECT ${CAMPOS}
       FROM delivery_proofs p
       LEFT JOIN drivers d ON d.id = p.driver_id
      WHERE p.company_id = $1 AND p.id = $2`,
    [companyId, id],
  );
  return rows[0] ?? null;
};

const porHash = async (
  companyId: string,
  orderId: string,
  sha256: string,
): Promise<ProvaLinha | null> => {
  const { rows } = await query<ProvaLinha>(
    `SELECT ${CAMPOS}
       FROM delivery_proofs p
       LEFT JOIN drivers d ON d.id = p.driver_id
      WHERE p.company_id = $1 AND p.order_id = $2 AND p.sha256 = $3`,
    [companyId, orderId, sha256],
  );
  return rows[0] ?? null;
};

/** Metadata for one order's proofs, oldest first. Never the bytes. */
export const daEncomenda = async (companyId: string, orderId: string): Promise<ProvaLinha[]> => {
  const { rows } = await query<ProvaLinha>(
    `SELECT ${CAMPOS}
       FROM delivery_proofs p
       LEFT JOIN drivers d ON d.id = p.driver_id
      WHERE p.company_id = $1 AND p.order_id = $2
      ORDER BY p.created_at, p.id`,
    [companyId, orderId],
  );
  return rows;
};

const CONTAGEM = `SELECT count(*) AS total FROM delivery_proofs
                   WHERE company_id = $1 AND order_id = $2`;

/** How many proofs an order has, which is all the state machine needs to know. */
export const contar = async (companyId: string, orderId: string): Promise<number> => {
  const { rows } = await query<{ total: string }>(CONTAGEM, [companyId, orderId]);
  return Number(rows[0]?.total ?? 0);
};

/**
 * The same count inside a caller's transaction. The delivery rule reads it while holding
 * the order row, so a proof arriving in the same instant cannot land between the check
 * and the state change.
 */
export const contarNaTransacao = async (
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<number> => {
  const { rows } = await client.query<{ total: string }>(CONTAGEM, [companyId, orderId]);
  return Number(rows[0]?.total ?? 0);
};

/** The bytes, for the one endpoint that serves a file. */
export const bytesDe = async (
  companyId: string,
  id: string,
): Promise<{ bytes: Buffer; mimeType: string; sha256: string; createdAt: Date } | null> => {
  const { rows } = await query<{
    bytes: Buffer;
    mime_type: string;
    sha256: string;
    created_at: Date;
  }>(
    `SELECT bytes, mime_type, sha256, created_at
       FROM delivery_proofs
      WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );

  const linha = rows[0];
  if (linha === undefined) return null;

  return {
    bytes: linha.bytes,
    mimeType: linha.mime_type,
    sha256: linha.sha256,
    createdAt: linha.created_at,
  };
};

export const paraDto = (linha: ProvaLinha) => ({
  id: linha.id,
  kind: linha.kind,
  mimeType: linha.mime_type,
  byteSize: linha.byte_size,
  // The interface shows a short prefix beside a proof: two photographs of the same door
  // taken minutes apart look identical, and the hash is how somebody can tell whether
  // they are looking at the same file twice.
  sha256: linha.sha256,
  ...(linha.driver_id !== null ? { driverId: linha.driver_id } : {}),
  ...(linha.driver_name !== null ? { driverName: linha.driver_name } : {}),
  uploadedBy: linha.uploader_label,
  ...(linha.latitude !== null && linha.longitude !== null
    ? { latitude: Number(linha.latitude), longitude: Number(linha.longitude) }
    : {}),
  ...(linha.accuracy_meters !== null ? { accuracyMeters: linha.accuracy_meters } : {}),
  // Both clocks travel, and the interface shows the gap when there is one. See the
  // migration for why neither is dropped in favour of the other.
  ...(linha.captured_at !== null ? { capturedAt: linha.captured_at.toISOString() } : {}),
  storedAt: linha.created_at.toISOString(),
  /** Relative on purpose: the browser is same-origin and a stored absolute URL rots. */
  url: `/api/orders/${linha.order_id}/proofs/${linha.id}/file`,
});
