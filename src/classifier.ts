type Tensor = { data: Float32Array; channels: number; width: number; height: number };

let modelPromise: Promise<Classifier> | undefined;

export function getClassifier(): Promise<Classifier> {
  if (!modelPromise) modelPromise = Classifier.load();
  return modelPromise;
}

class Classifier {
  private constructor(private readonly weights: Map<string, Float32Array>) {}

  static async load(): Promise<Classifier> {
    const [metaRes, binRes] = await Promise.all([
      fetch(modelUrl('classifier.json')),
      fetch(modelUrl('classifier-weights.f32.bin')),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('Файлы модели не найдены.');
    const meta = await metaRes.json() as { tensors: { name: string; shape: number[] }[] };
    const values = new Float32Array(await binRes.arrayBuffer());
    const weights = new Map<string, Float32Array>();
    let offset = 0;
    for (const spec of meta.tensors) {
      const count = spec.shape.reduce((n, v) => n * v, 1);
      weights.set(spec.name, values.subarray(offset, offset + count));
      offset += count;
    }
    return new Classifier(weights);
  }

  predict(input: Float32Array): Float32Array {
    let t: Tensor = { data: input, channels: 3, width: 256, height: 256 };
    t = instanceNorm(relu(conv(t, this.w('model.1.weight'), this.w('model.1.bias'), 16, 3, 2, 1)), this.w('model.3.weight'), this.w('model.3.bias'));
    t = instanceNorm(relu(conv(t, this.w('model.4.weight'), this.w('model.4.bias'), 32, 3, 2, 1)), this.w('model.6.weight'), this.w('model.6.bias'));
    t = instanceNorm(relu(conv(t, this.w('model.7.weight'), this.w('model.7.bias'), 64, 3, 2, 1)), this.w('model.9.weight'), this.w('model.9.bias'));
    t = instanceNorm(relu(conv(t, this.w('model.10.weight'), this.w('model.10.bias'), 128, 3, 2, 1)), this.w('model.12.weight'), this.w('model.12.bias'));
    t = relu(conv(t, this.w('model.13.weight'), this.w('model.13.bias'), 128, 3, 2, 1));
    t = conv(t, this.w('model.16.weight'), this.w('model.16.bias'), 3, 8, 1, 0);
    return t.data;
  }

  private w(name: string): Float32Array {
    const value = this.weights.get(name);
    if (!value) throw new Error(`Нет веса: ${name}`);
    return value;
  }
}

function modelUrl(file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}models/${file}`, self.location.origin).toString();
}

function conv(
  input: Tensor, weights: Float32Array, bias: Float32Array,
  outCh: number, k: number, stride: number, pad: number,
): Tensor {
  const w = Math.floor((input.width + 2 * pad - k) / stride) + 1;
  const h = Math.floor((input.height + 2 * pad - k) / stride) + 1;
  const out = new Float32Array(outCh * w * h);
  for (let oc = 0; oc < outCh; oc += 1) {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let sum = bias[oc];
      for (let ic = 0; ic < input.channels; ic += 1) {
        const kOff = (oc * input.channels + ic) * k * k;
        const iOff = ic * input.width * input.height;
        for (let ky = 0; ky < k; ky += 1) {
          const sy = y * stride + ky - pad;
          if (sy < 0 || sy >= input.height) continue;
          for (let kx = 0; kx < k; kx += 1) {
            const sx = x * stride + kx - pad;
            if (sx >= 0 && sx < input.width) sum += input.data[iOff + sy * input.width + sx] * weights[kOff + ky * k + kx];
          }
        }
      }
      out[oc * w * h + y * w + x] = sum;
    }
  }
  return { data: out, channels: outCh, width: w, height: h };
}

function relu(t: Tensor): Tensor {
  for (let i = 0; i < t.data.length; i += 1) if (t.data[i] < 0) t.data[i] *= 0.2;
  return t;
}

function instanceNorm(t: Tensor, scale: Float32Array, shift: Float32Array): Tensor {
  const n = t.width * t.height;
  for (let c = 0; c < t.channels; c += 1) {
    const off = c * n;
    let sum = 0; let sq = 0;
    for (let i = 0; i < n; i += 1) { sum += t.data[off + i]; sq += t.data[off + i] ** 2; }
    const mean = sum / n;
    const inv = 1 / Math.sqrt(Math.max(0, sq / n - mean ** 2) + 1e-5);
    for (let i = 0; i < n; i += 1) t.data[off + i] = (t.data[off + i] - mean) * inv * scale[c] + shift[c];
  }
  return t;
}
