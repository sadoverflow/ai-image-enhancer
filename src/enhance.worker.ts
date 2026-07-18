/// <reference lib="webworker" />

import { getClassifier } from './classifier';
import { applyLut, getLutAssets } from './lut';
import { toModelInput } from './preprocess';
import type { TaskInfo, TaskStatus } from './ImageEnhancer';

type Job = {
  id: string;
  source: Blob;
  outputMime: 'image/jpeg' | 'image/png';
};

const queue: Job[] = [];
const cancelled = new Set<string>();
let working = false;

self.onmessage = (e: MessageEvent<{ type: 'enqueue'; id: string; source: Blob; outputMime: 'image/jpeg' | 'image/png' } | { type: 'abort'; id: string }>) => {
  const msg = e.data;
  if (msg.type === 'abort') {
    cancelled.add(msg.id);
    const idx = queue.findIndex((j) => j.id === msg.id);
    if (idx >= 0) {
      queue.splice(idx, 1);
      status(msg.id, 'cancelled', 0);
    }
    return;
  }
  queue.push({ id: msg.id, source: msg.source, outputMime: msg.outputMime });
  status(msg.id, 'queued', 0);
  void next();
};

async function next() {
  if (working || queue.length === 0) return;
  working = true;
  const job = queue.shift()!;

  try {
    if (cancelled.has(job.id)) throw abortError();
    status(job.id, 'decoding', 10);

    const bitmap = await createImageBitmap(job.source, { imageOrientation: 'from-image' });
    try {
      if (bitmap.width * bitmap.height > 15_000_000) throw new Error('Лимит 15 Мп');
      if (cancelled.has(job.id)) throw abortError();

      status(job.id, 'inferring', 25);
      const [input, luts, model] = await Promise.all([toModelInput(bitmap), getLutAssets(), getClassifier()]);
      const weights = model.predict(input);
      if (cancelled.has(job.id)) throw abortError();

      status(job.id, 'applying-lut', 40);
      const result = await applyLut(
        bitmap,
        luts,
        weights,
        job.outputMime,
        (p) => status(job.id, 'applying-lut', p),
        () => cancelled.has(job.id),
      );

      if (cancelled.has(job.id)) throw abortError();
      status(job.id, 'completed', 100);
      self.postMessage({ type: 'completed', id: job.id, result });
    } finally {
      bitmap.close();
    }
  } catch (e) {
    if (isAbort(e) || cancelled.has(job.id)) status(job.id, 'cancelled', 0);
    else status(job.id, 'failed', 0, e instanceof Error ? e.message : 'Ошибка');
  } finally {
    cancelled.delete(job.id);
    working = false;
    void next();
  }
}

function status(id: string, s: TaskStatus, progress: number, error?: string) {
  self.postMessage({ type: 'status', task: { id, status: s, progress, error } satisfies TaskInfo });
}

function abortError() {
  return new DOMException('Отменено', 'AbortError');
}

function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError';
}
