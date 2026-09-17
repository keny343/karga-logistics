import { AppError } from '../utils/errors.js';

/**
 * Where a point is allowed to be.
 *
 * Angola's bounding box, generously rounded. This is not a precision check — it
 * exists to catch the one mistake that happens every time coordinates are typed or
 * copied: latitude and longitude the wrong way round. Luanda is at `-8.83, 13.23`,
 * and `13.23, -8.83` is a valid pair of numbers in the Atlantic off Guinea. A
 * marker there is not obviously wrong on a zoomed-in map; it is obviously wrong
 * here.
 */
export const LIMITES_ANGOLA = {
  latitude: { min: -18.2, max: -4.2 },
  longitude: { min: 11.4, max: 24.2 },
} as const;

export interface Ponto {
  readonly latitude: number;
  readonly longitude: number;
}

export const dentroDeAngola = (ponto: Ponto): boolean =>
  ponto.latitude >= LIMITES_ANGOLA.latitude.min &&
  ponto.latitude <= LIMITES_ANGOLA.latitude.max &&
  ponto.longitude >= LIMITES_ANGOLA.longitude.min &&
  ponto.longitude <= LIMITES_ANGOLA.longitude.max;

/** True when the pair would be inside Angola if the two numbers were swapped. */
export const pareceTrocado = (ponto: Ponto): boolean =>
  !dentroDeAngola(ponto) &&
  dentroDeAngola({ latitude: ponto.longitude, longitude: ponto.latitude });

/**
 * The centre of Luanda, used to frame an empty map. A map that opens on the middle
 * of the Atlantic because there is nothing to show is a map that looks broken.
 */
export const CENTRO_LUANDA: Ponto = { latitude: -8.8383, longitude: 13.2344 };

/**
 * Throws rather than returning false, so a caller cannot forget to check. The
 * swapped case gets its own message with the corrected pair in it: "coordenadas
 * inválidas" would leave whoever typed them looking for a mistake that is one
 * exchange away.
 */
export const assegurarPontoEmAngola = (ponto: Ponto): void => {
  if (dentroDeAngola(ponto)) return;

  if (pareceTrocado(ponto)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Latitude e longitude parecem trocadas. Em Angola a latitude é negativa: tenta ${ponto.longitude}, ${ponto.latitude}.`,
      { details: [{ field: 'latitude', message: 'Parece ser a longitude.' }] },
    );
  }

  throw new AppError('VALIDATION_ERROR', 'O ponto indicado está fora de Angola.', {
    details: [{ field: 'latitude', message: 'Fora dos limites de Angola.' }],
  });
};
