import { AppError } from '../utils/errors.js';

/**
 * What an image is allowed to be, decided by looking at the bytes.
 *
 * Everything a client says about a file is a claim: the field name, the filename, the
 * extension and the `Content-Type` are all written by whoever is uploading. This module
 * checks the only thing that is not - the first bytes of the file - and refuses anything
 * whose contents disagree with its label.
 *
 * That matters even though nothing here is ever executed. A file stored as `image/png`
 * and served back with that header, while actually being HTML, is a stored XSS on
 * whichever browser sniffs it; a PHP file with a `.jpg` name is only harmless for as
 * long as nobody points a webserver at the directory. Both attacks begin with the server
 * believing the label, so the label is not believed.
 *
 * Three formats, and no more. Every phone camera produces JPEG, canvases produce PNG,
 * and WebP arrives from newer Android browsers. GIF is excluded because an animated
 * proof of delivery is not a thing anyone needs; SVG is excluded emphatically, because
 * an SVG is a document that can carry script.
 */

export const TIPOS_ACEITES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoImagem = (typeof TIPOS_ACEITES)[number];

/**
 * Five megabytes, which no honest proof reaches: the browser downscales a photo to
 * roughly 1600 px before sending, which lands a few hundred kilobytes, and a signature
 * is smaller still. The limit exists for the dishonest case and for the phone whose
 * camera app ignores the resize.
 */
export const TAMANHO_MAXIMO = 5 * 1024 * 1024;

/** Enough bytes for every signature below, with room to spare. */
const CABECALHO_MINIMO = 16;

const EXTENSOES: Record<TipoImagem, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

const comeca = (bytes: Buffer, assinatura: readonly number[]): boolean =>
  assinatura.every((byte, indice) => bytes[indice] === byte);

/**
 * The format the bytes actually are, or undefined for anything else.
 *
 * Hand-written rather than pulled from a library: three formats is a short list, the
 * signatures are stable parts of their file formats, and the check is the security
 * boundary of this feature - worth being able to read in full, here, over saving twenty
 * lines by depending on a package that must then be kept current.
 */
export const tipoRealDe = (bytes: Buffer): TipoImagem | undefined => {
  if (bytes.length < CABECALHO_MINIMO) return undefined;

  // JPEG: FF D8 FF. Every variant - JFIF, Exif, raw - shares it.
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: the eight-byte signature, including the CR/LF pair that exists to detect a
  // transfer that mangled line endings.
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP: a RIFF container whose form type is WEBP, at offset 8. The four bytes between
  // are the file length, so they are skipped rather than matched.
  if (
    comeca(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return undefined;
};

const extensaoDe = (nome: string): string => {
  const ponto = nome.lastIndexOf('.');
  return ponto === -1 ? '' : nome.slice(ponto).toLowerCase();
};

export interface Ficheiro {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

/**
 * Accepts a file or explains, in a sentence a driver can act on, why not.
 *
 * The returned type is the sniffed one, never the declared one, so what gets stored and
 * later served is what the bytes are. The refusals are deliberately specific: "isto não
 * é uma imagem" and "a imagem é demasiado grande" lead to different actions, and a
 * driver at a door with one bar of signal deserves to know which one he is facing.
 */
export const validarImagem = (ficheiro: Ficheiro): TipoImagem => {
  if (ficheiro.buffer.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'O ficheiro chegou vazio. Tenta enviar outra vez.');
  }

  if (ficheiro.buffer.length > TAMANHO_MAXIMO) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      'A imagem é demasiado grande. O limite é 5 MB por prova.',
    );
  }

  const real = tipoRealDe(ficheiro.buffer);
  if (real === undefined) {
    throw new AppError(
      'VALIDATION_ERROR',
      'O ficheiro não é uma imagem JPEG, PNG ou WebP. Tira a fotografia com a câmara do telefone.',
    );
  }

  // The declared type is checked against the real one instead of being ignored: a
  // mismatch is worth refusing rather than quietly correcting, because it means the
  // client is confused about what it is sending and the next thing it sends is suspect.
  if (ficheiro.mimetype !== real) {
    throw new AppError(
      'VALIDATION_ERROR',
      `O ficheiro diz ser ${ficheiro.mimetype} mas é ${real}. Envia a imagem original, sem a renomear.`,
    );
  }

  const extensao = extensaoDe(ficheiro.originalname);
  if (extensao !== '' && !EXTENSOES[real].includes(extensao)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Uma imagem ${real} não pode ter a extensão ${extensao}.`,
    );
  }

  return real;
};
