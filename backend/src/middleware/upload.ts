import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { TAMANHO_MAXIMO } from '../domain/imagem.js';
import { AppError } from '../utils/errors.js';

/**
 * Multipart parsing for proof images.
 *
 * Memory storage, deliberately. Nothing is ever written to the container's disk: the
 * bytes go from the request into a `bytea` column, so there is no temporary file to name,
 * to clean up, or to leave behind when a request fails halfway. It also means no path is
 * ever built from anything a client sent, which is where most upload vulnerabilities
 * start.
 *
 * The size limit is enforced here as well as in the domain check. Multer's limit aborts
 * the stream as soon as it is exceeded, so a hundred-megabyte body never fully arrives;
 * the domain check is what protects the database when bytes reach it by another route.
 */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TAMANHO_MAXIMO,
    // One image per request, and no other parts. A form with twenty files is not
    // something this API offers, so it is refused rather than partly honoured.
    files: 1,
    // The text fields are a kind, a coordinate pair, an accuracy and a timestamp.
    fields: 8,
    fieldSize: 1024,
  },
});

const MENSAGENS: Partial<Record<MulterError['code'], string>> = {
  LIMIT_FILE_SIZE: 'A imagem é demasiado grande. O limite é 5 MB por prova.',
  LIMIT_FILE_COUNT: 'Envia uma imagem de cada vez.',
  LIMIT_UNEXPECTED_FILE: 'Envia a imagem no campo "file".',
  LIMIT_FIELD_COUNT: 'O formulário traz campos a mais.',
  LIMIT_FIELD_VALUE: 'Um dos campos do formulário é demasiado longo.',
};

/**
 * Parses one image, and turns multer's errors into the API's own.
 *
 * Without the translation a rejected upload leaves through the generic handler as a 500,
 * which tells a driver holding a parcel that the system is broken when the truth is that
 * his photograph was too large. Every branch here is a sentence he can act on.
 */
export const umaImagem = (req: Request, res: Response, next: NextFunction): void => {
  parser.single('file')(req, res, (erro: unknown) => {
    if (erro === undefined || erro === null) {
      next();
      return;
    }

    if (erro instanceof MulterError) {
      const mensagem = MENSAGENS[erro.code] ?? 'Não foi possível ler a imagem enviada.';
      next(
        new AppError(erro.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR', mensagem),
      );
      return;
    }

    // A body that is not multipart at all arrives here, which is a client mistake worth
    // naming rather than a server fault worth a stack trace.
    next(
      new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        'A prova é enviada como multipart/form-data, com a imagem no campo "file".',
      ),
    );
  });
};
