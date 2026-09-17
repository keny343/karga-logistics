/**
 * Shrinking a photograph before it leaves the phone.
 *
 * A picture straight from an Angolan mid-range Android is three to six megabytes. Sending
 * it costs the driver's data bundle, takes a minute on a bad connection at a door, and
 * fills a database column for no gain: nobody resolving a delivery dispute needs to count
 * the threads on a doormat. Resized to 1600 px it lands between one and four hundred
 * kilobytes and still shows a house number, a parcel and a face.
 *
 * The resize also strips EXIF, which is the point worth stating out loud: a phone
 * photograph carries the GPS point where it was taken, and re-encoding through a canvas
 * drops it. The position that travels with a proof is the one the driver's browser
 * reported explicitly, so what is stored is what was asked for rather than whatever the
 * camera app happened to embed.
 */

/** The long edge, after which detail stops answering any question anybody asks. */
const LADO_MAXIMO = 1600;

/** High enough that text on a label stays readable; low enough to halve the size. */
const QUALIDADE = 0.82;

const escalaPara = (largura: number, altura: number): number => {
  const maior = Math.max(largura, altura);
  return maior <= LADO_MAXIMO ? 1 : LADO_MAXIMO / maior;
};

export interface Reduzida {
  readonly blob: Blob;
  readonly nome: string;
  readonly largura: number;
  readonly altura: number;
}

/**
 * Reduces a picked image to a JPEG.
 *
 * Always JPEG, whatever came in: it is what a photograph should be, every browser encodes
 * it, and it keeps the declared type, the extension and the bytes in agreement - which is
 * precisely what the server checks.
 *
 * Failure is returned rather than thrown for one case only: a file that is not an image at
 * all cannot be decoded, and the caller has a better sentence for that than a stack trace.
 */
export const reduzirImagem = async (ficheiro: File): Promise<Reduzida | null> => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(ficheiro);
  } catch {
    return null;
  }

  const escala = escalaPara(bitmap.width, bitmap.height);
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;

  const contexto = canvas.getContext('2d');
  if (contexto === null) return null;
  contexto.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolver) => {
    canvas.toBlob(resolver, 'image/jpeg', QUALIDADE);
  });
  if (blob === null) return null;

  return { blob, nome: 'prova.jpg', largura, altura };
};

/**
 * The driver's position, asked for once, with a short patience.
 *
 * A proof without coordinates is still a proof - at a counter, indoors, a phone often has
 * no fix - so this never blocks an upload. It waits a few seconds and gives up, because a
 * driver holding a parcel should not be watching a spinner while the GPS makes up its mind.
 */
export const posicaoAgora = (): Promise<GeolocationPosition | null> =>
  new Promise((resolver) => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      resolver(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolver,
      () => resolver(null),
      { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
    );
  });
