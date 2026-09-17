import { vi } from 'vitest';

/**
 * A canvas, for a test environment that does not have one.
 *
 * jsdom implements the element and none of the drawing: `getContext('2d')` returns null and
 * `toBlob` does not exist. Installing the native `canvas` package would give real pixels,
 * at the cost of a compiler toolchain in CI for tests that never look at a pixel - what they
 * check is that a stroke turns the signature into something sendable, and that what gets
 * sent is a PNG of a certain kind.
 *
 * So the drawing calls are recorded and `toBlob` hands back bytes. The one thing kept
 * honest is the shape of the API: if the component starts calling something this stub does
 * not have, the test fails rather than silently passing.
 */

export interface CanvasFalso {
  /** Every 2d call made, in order, for a test that wants to assert on drawing. */
  readonly chamadas: string[];
  readonly blobs: Blob[];
}

export const instalarCanvasFalso = (): CanvasFalso => {
  const chamadas: string[] = [];
  const blobs: Blob[] = [];

  const contexto = {
    scale: vi.fn(() => chamadas.push('scale')),
    fillRect: vi.fn(() => chamadas.push('fillRect')),
    beginPath: vi.fn(() => chamadas.push('beginPath')),
    moveTo: vi.fn(() => chamadas.push('moveTo')),
    lineTo: vi.fn(() => chamadas.push('lineTo')),
    stroke: vi.fn(() => chamadas.push('stroke')),
    drawImage: vi.fn(() => chamadas.push('drawImage')),
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
  };

  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => contexto,
  ) as unknown as HTMLCanvasElement['getContext'];

  HTMLCanvasElement.prototype.toBlob = vi.fn(
    (retorno: BlobCallback, tipo?: string) => {
      // A PNG signature, so anything downstream that sniffs the bytes sees what the type
      // claims - which is exactly what the server does with them.
      const bytes =
        tipo === 'image/jpeg'
          ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
          : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const blob = new Blob([bytes], { type: tipo ?? 'image/png' });
      blobs.push(blob);
      retorno(blob);
    },
  ) as unknown as HTMLCanvasElement['toBlob'];

  // A phone photograph, as far as the resize code is concerned: a size to scale down from.
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (origem: Blob) => {
      // A file that is not an image cannot be decoded, and the code has a branch for it.
      if (!origem.type.startsWith('image/')) throw new Error('not an image');
      return { width: 3000, height: 4000, close: vi.fn() };
    }),
  );

  // A pointer event carries the capture methods; jsdom's element does not have them.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();

  return { chamadas, blobs };
};
