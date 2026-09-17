import { deflateSync } from 'node:zlib';

/**
 * Two pictures, drawn in code.
 *
 * The demonstration data needs delivery proofs, because a parcel marked ENTREGUE with
 * nothing behind it contradicts the rule the application spends its time enforcing - a
 * customer opening a delivered order would read "ainda sem prova" under a delivery that
 * closed. Photographs of real doorways cannot be committed to a repository, and a stock
 * image would be a licence to check and a megabyte to carry, so these are painted pixel by
 * pixel and encoded here: a parcel on a step and a signature on a line.
 *
 * PNG rather than JPEG because a PNG encoder is a CRC, a deflate and four chunk headers,
 * while a JPEG encoder is a discrete cosine transform. Both are accepted by the upload
 * validation, and PNG is what the signature pad in the browser produces anyway.
 */

const CRC_TABELA = ((): Uint32Array => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

const crc32 = (dados: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of dados) c = (CRC_TABELA[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const bloco = (tipo: string, dados: Buffer): Buffer => {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, verificacao]);
};

type Pintor = (x: number, y: number) => readonly [number, number, number];

/** Encodes an RGB image as a PNG. One filter byte per row, then the raw pixels. */
const png = (largura: number, altura: number, pinta: Pintor): Buffer => {
  const linhas = Buffer.alloc(altura * (1 + largura * 3));
  let posicao = 0;
  for (let y = 0; y < altura; y += 1) {
    linhas[posicao] = 0;
    posicao += 1;
    for (let x = 0; x < largura; x += 1) {
      const [r, g, b] = pinta(x, y);
      linhas[posicao] = r;
      linhas[posicao + 1] = g;
      linhas[posicao + 2] = b;
      posicao += 3;
    }
  }

  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // bits per channel
  cabecalho[9] = 2; // truecolour
  cabecalho[10] = 0; // deflate
  cabecalho[11] = 0; // no filter beyond the per-row one
  cabecalho[12] = 0; // no interlacing

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', deflateSync(linhas, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
};

const misturar = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  peso: number,
): readonly [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * peso),
  Math.round(a[1] + (b[1] - a[1]) * peso),
  Math.round(a[2] + (b[2] - a[2]) * peso),
];

/**
 * A cardboard box on a doorstep, seen from a driver's height: wall above, step below, box
 * in the middle with a lighter label on it. Not a photograph, and not pretending to be one
 * either - it reads as a placeholder at thumbnail size, which is what it is.
 */
export const fotografiaDemo = (variacao: number): Buffer => {
  const largura = 480;
  const altura = 360;
  const parede: readonly [number, number, number] = [214, 205, 190];
  const chao: readonly [number, number, number] = [120, 116, 112];
  const caixa: readonly [number, number, number] = [176, 132, 84];
  const etiqueta: readonly [number, number, number] = [244, 242, 236];

  const horizonte = 196 + (variacao % 3) * 12;
  const esquerda = 132 + (variacao % 4) * 10;
  const direita = esquerda + 190;
  const topo = horizonte - 118;

  return png(largura, altura, (x, y) => {
    if (x >= esquerda && x < direita && y >= topo && y < horizonte + 14) {
      // The label, and a seam down the middle of the lid.
      const naEtiqueta = x > esquerda + 40 && x < direita - 40 && y > topo + 26 && y < topo + 62;
      if (naEtiqueta) return etiqueta;
      if (Math.abs(x - (esquerda + direita) / 2) < 2 && y < topo + 20) return misturar(caixa, chao, 0.45);
      // Light falls from the left, so the right face is darker.
      return misturar(caixa, chao, ((x - esquerda) / (direita - esquerda)) * 0.35);
    }

    if (y >= horizonte) {
      const risca = Math.floor((y - horizonte) / 26) % 2 === 0 ? 0.06 : 0;
      return misturar(chao, parede, risca);
    }

    // A slight vignette, the way a phone camera renders a wall.
    const centro = Math.hypot(x - largura / 2, y - altura / 2) / (largura / 2);
    return misturar(parede, chao, Math.min(centro * 0.22, 0.3));
  });
};

/**
 * A signature on a line: a hand-shaped scribble made of two sine waves at different
 * frequencies, thick enough to survive being scaled into a 72 px thumbnail.
 */
export const assinaturaDemo = (variacao: number): Buffer => {
  const largura = 420;
  const altura = 160;
  const tinta: readonly [number, number, number] = [17, 24, 39];
  const branco: readonly [number, number, number] = [255, 255, 255];
  const linha: readonly [number, number, number] = [203, 213, 225];
  const fase = (variacao % 5) * 0.7;

  const alturaDoTraco = (x: number): number => {
    const t = (x - 40) / (largura - 80);
    return 96 - Math.sin(t * Math.PI * 3 + fase) * 34 - Math.sin(t * Math.PI * 7 + fase) * 9;
  };

  return png(largura, altura, (x, y) => {
    if (y > 120 && y < 122 && x > 24 && x < largura - 24) return linha;
    if (x < 40 || x > largura - 40) return branco;

    const distancia = Math.abs(y - alturaDoTraco(x));
    if (distancia < 2.2) return tinta;
    // A soft edge, so the stroke does not look like a staircase.
    if (distancia < 3.6) return misturar(tinta, branco, (distancia - 2.2) / 1.4);
    return branco;
  });
};
