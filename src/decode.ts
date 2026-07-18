const HEIC = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function outputMimeFor(source: Blob): 'image/jpeg' | 'image/png' {
  const type = source.type;
  if (type === 'image/png' || type === 'image/bmp' || type === 'image/x-ms-bmp') return 'image/png';
  return 'image/jpeg';
}

export async function prepareSource(source: Blob): Promise<Blob> {
  if (!HEIC.has(source.type.toLowerCase()) && !(source instanceof File && /\.(heic|heif)$/i.test(source.name))) {
    return source;
  }
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: source, toType: 'image/png', quality: 1 });
  return Array.isArray(converted) ? converted[0] : converted;
}
