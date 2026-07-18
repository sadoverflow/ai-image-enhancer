const SIZE = 256;

export async function toModelInput(bitmap: ImageBitmap): Promise<Float32Array> {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен.');
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    out[i] = rgba[o] / 255;
    out[n + i] = rgba[o + 1] / 255;
    out[n * 2 + i] = rgba[o + 2] / 255;
  }
  return out;
}
