type LutAssets = { dimension: number; bases: Float32Array };

let assetsPromise: Promise<LutAssets> | undefined;

export function getLutAssets(): Promise<LutAssets> {
  if (!assetsPromise) assetsPromise = loadLuts();
  return assetsPromise;
}

async function loadLuts(): Promise<LutAssets> {
  const [metaRes, binRes] = await Promise.all([
    fetch(modelUrl('lut-bases.json')),
    fetch(modelUrl('lut-bases.f16.bin')),
  ]);
  if (!metaRes.ok || !binRes.ok) throw new Error('Файлы LUT не найдены.');
  const meta = await metaRes.json() as { shape: number[]; dtype: string };
  const [bases, channels, r, g, b] = meta.shape;
  if (meta.dtype !== 'float16-le' || bases !== 3 || channels !== 3 || r !== g || r !== b) {
    throw new Error('Неверный формат LUT.');
  }
  const half = new Uint16Array(await binRes.arrayBuffer());
  const floats = new Float32Array(half.length);
  for (let i = 0; i < half.length; i += 1) floats[i] = halfToFloat(half[i]);
  return { dimension: r, bases: floats };
}

function modelUrl(file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}models/${file}`, self.location.origin).toString();
}

export async function applyLut(
  bitmap: ImageBitmap,
  assets: LutAssets,
  weights: Float32Array,
  mime: 'image/jpeg' | 'image/png',
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): Promise<Blob> {
  try {
    return await applyWebGl(bitmap, assets, weights, mime);
  } catch {
    return applyCpu(bitmap, assets, weights, mime, onProgress, cancelled);
  }
}

async function applyWebGl(
  bitmap: ImageBitmap,
  assets: LutAssets,
  weights: Float32Array,
  mime: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 недоступен.');
  if (!gl.getExtension('OES_texture_float_linear')) {
    throw new Error('Линейная фильтрация float-текстур недоступна.');
  }

  const vs = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = (aPos + 1.0) * 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fs = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler3D uL0, uL1, uL2;
uniform vec3 uW;
in vec2 vUv; out vec4 outColor;
void main() {
  vec4 s = texture(uSrc, vUv);
  vec3 c = clamp(s.rgb, 0.0, 1.0);
  vec3 e = uW.x * texture(uL0, c).rgb + uW.y * texture(uL1, c).rgb + uW.z * texture(uL2, c).rgb;
  outColor = vec4(clamp(e, 0.0, 1.0), s.a);
}`;

  const program = linkProgram(gl, vs, fs);
  gl.useProgram(program);
  gl.viewport(0, 0, bitmap.width, bitmap.height);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.uniform1i(gl.getUniformLocation(program, 'uSrc'), 0);

  const lutTextures: WebGLTexture[] = [];
  for (let i = 0; i < 3; i += 1) {
    gl.activeTexture(gl.TEXTURE1 + i);
    const lutTexture = uploadLut(gl, assets, i);
    lutTextures.push(lutTexture);
    gl.bindTexture(gl.TEXTURE_3D, lutTexture);
    gl.uniform1i(gl.getUniformLocation(program, `uL${i}`), i + 1);
  }
  gl.uniform3fv(gl.getUniformLocation(program, 'uW'), weights);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const blob = await canvas.convertToBlob({ type: mime, quality: mime === 'image/jpeg' ? 0.92 : undefined });
  gl.deleteTexture(tex);
  lutTextures.forEach((texture) => gl.deleteTexture(texture));
  gl.deleteBuffer(buf);
  gl.deleteProgram(program);
  return blob;
}

async function applyCpu(
  bitmap: ImageBitmap,
  assets: LutAssets,
  weights: Float32Array,
  mime: 'image/jpeg' | 'image/png',
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas недоступен.');
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const lut = mixLuts(assets, weights);
  const dim = assets.dimension;
  const rows = 64;

  for (let y0 = 0; y0 < bitmap.height; y0 += rows) {
    if (cancelled()) throw new DOMException('Отменено.', 'AbortError');
    const y1 = Math.min(bitmap.height, y0 + rows);
    applyRows(image.data, bitmap.width, y0, y1, dim, lut);
    onProgress(35 + Math.round((y1 / bitmap.height) * 55));
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  ctx.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: mime, quality: mime === 'image/jpeg' ? 0.92 : undefined });
}

function mixLuts(assets: LutAssets, weights: Float32Array): Float32Array {
  const d = assets.dimension;
  const voxels = d ** 3;
  const mixed = new Float32Array(voxels * 3);
  for (let ch = 0; ch < 3; ch += 1) for (let r = 0; r < d; r += 1) for (let g = 0; g < d; g += 1) for (let b = 0; b < d; b += 1) {
    const target = ((ch * d + r) * d + g) * d + b;
    let v = 0;
    for (let i = 0; i < 3; i += 1) v += assets.bases[(((i * 3 + ch) * d + r) * d + g) * d + b] * weights[i];
    mixed[target] = v;
  }
  return mixed;
}

function applyRows(data: Uint8ClampedArray, width: number, y0: number, y1: number, dim: number, lut: Float32Array): void {
  const scale = dim - 1;
  for (let y = y0; y < y1; y += 1) for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 4;
    const rgb = sample(lut, dim, data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, scale);
    data[o] = Math.round(clamp01(rgb[0]) * 255);
    data[o + 1] = Math.round(clamp01(rgb[1]) * 255);
    data[o + 2] = Math.round(clamp01(rgb[2]) * 255);
  }
}

function sample(lut: Float32Array, dim: number, r: number, g: number, b: number, scale: number): [number, number, number] {
  const fx = r * scale; const fy = g * scale; const fz = b * scale;
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, dim - 1); const y1 = Math.min(y0 + 1, dim - 1); const z1 = Math.min(z0 + 1, dim - 1);
  const tx = fx - x0; const ty = fy - y0; const tz = fz - z0;
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch += 1) {
    const at = (r: number, g: number, b: number) => lut[((ch * dim + r) * dim + g) * dim + b];
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
    const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
    const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
    const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
    out[ch] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
  return out;
}

function uploadLut(gl: WebGL2RenderingContext, assets: LutAssets, basis: number): WebGLTexture {
  const d = assets.dimension;
  const packed = new Uint16Array(d ** 3 * 4);
  for (let b = 0; b < d; b += 1) for (let g = 0; g < d; g += 1) for (let r = 0; r < d; r += 1) {
    const target = ((b * d + g) * d + r) * 4;
    for (let ch = 0; ch < 3; ch += 1) {
      packed[target + ch] = floatToHalf(assets.bases[(((basis * 3 + ch) * d + r) * d + g) * d + b]);
    }
    packed[target + 3] = 0x3c00;
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, d, d, d, 0, gl.RGBA, gl.HALF_FLOAT, packed);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('LUT-текстура не поддерживается.');
  return tex;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader error');
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
  return program;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function halfToFloat(v: number): number {
  const sign = (v & 0x8000) === 0 ? 1 : -1;
  const exp = (v >>> 10) & 0x1f;
  const frac = v & 0x03ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function floatToHalf(v: number): number {
  if (!Number.isFinite(v)) return v < 0 ? 0xfc00 : 0x7c00;
  const sign = v < 0 ? 0x8000 : 0;
  const abs = Math.abs(v);
  if (abs === 0) return sign;
  if (abs >= 65504) return sign | 0x7bff;
  if (abs < 6.103515625e-5) return sign | Math.round(abs / 5.960464477539063e-8);
  const exp = Math.floor(Math.log2(abs));
  return sign | ((exp + 15) << 10) | Math.min(Math.round((abs / 2 ** exp - 1) * 1024), 1023);
}
