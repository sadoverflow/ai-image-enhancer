import { outputMimeFor, prepareSource } from './decode';

export type TaskStatus =
  | 'queued'
  | 'decoding'
  | 'inferring'
  | 'applying-lut'
  | 'encoding'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type TaskInfo = {
  id: string;
  status: TaskStatus;
  progress: number;
  error?: string;
};

type WorkerRequest =
  | { type: 'enqueue'; id: string; source: Blob; outputMime: 'image/jpeg' | 'image/png' }
  | { type: 'abort'; id: string };

type WorkerResponse =
  | { type: 'status'; task: TaskInfo }
  | { type: 'completed'; id: string; result: Blob };

type LocalTask = TaskInfo & {
  resolve: (blob: Blob) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<Blob>;
};

const done = (s: TaskStatus) => s === 'completed' || s === 'cancelled' || s === 'failed';

export class ImageEnhancer {
  private worker = new Worker(new URL('./enhance.worker.ts', import.meta.url), { type: 'module' });
  private tasks = new Map<string, LocalTask>();
  private listeners = new Set<(task: TaskInfo) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => {
      for (const task of this.tasks.values()) {
        if (!done(task.status)) this.setTask({ ...task, status: 'failed', error: e.message || 'Ошибка worker' });
      }
    };
  }

  submit(source: File | Blob | ArrayBuffer): string {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    let resolve!: (blob: Blob) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<Blob>((res, rej) => { resolve = res; reject = rej; });
    const task: LocalTask = { id, status: 'queued', progress: 0, resolve, reject, promise };
    this.tasks.set(id, task);
    this.emit(task);
    void this.sendToWorker(id, source);
    return id;
  }

  getStatus(id: string) {
    return this.tasks.get(id);
  }

  cancel(id: string) {
    const task = this.tasks.get(id);
    if (!task || done(task.status)) return false;
    this.worker.postMessage({ type: 'abort', id } satisfies WorkerRequest);
    return true;
  }

  getResult(id: string) {
    const task = this.tasks.get(id);
    return task ? task.promise : Promise.reject(new Error('Задача не найдена'));
  }

  onStatusChange(listener: (task: TaskInfo) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async sendToWorker(id: string, input: File | Blob | ArrayBuffer) {
    try {
      const task = this.tasks.get(id);
      if (!task) return;
      this.setTask({ ...task, status: 'decoding', progress: 5 });
      const blob = input instanceof ArrayBuffer ? new Blob([input]) : input;
      const source = await prepareSource(blob);
      this.worker.postMessage({
        type: 'enqueue',
        id,
        source,
        outputMime: outputMimeFor(blob),
      } satisfies WorkerRequest);
    } catch (e) {
      const task = this.tasks.get(id);
      if (task) this.setTask({ ...task, status: 'failed', progress: 0, error: e instanceof Error ? e.message : 'Ошибка' });
    }
  }

  private handleMessage(msg: WorkerResponse) {
    if (msg.type === 'status') {
      const task = this.tasks.get(msg.task.id);
      if (task) this.setTask({ ...task, ...msg.task });
      return;
    }
    const task = this.tasks.get(msg.id);
    if (task) task.resolve(msg.result);
  }

  private setTask(next: LocalTask) {
    const prev = this.tasks.get(next.id);
    if (!prev) return;
    const task = { ...prev, ...next };
    this.tasks.set(task.id, task);
    if (task.status === 'failed') task.reject(new Error(task.error ?? 'Ошибка'));
    if (task.status === 'cancelled') task.reject(new DOMException('Отменено', 'AbortError'));
    this.emit(task);
  }

  private emit(task: TaskInfo) {
    this.listeners.forEach((fn) => fn(task));
  }
}
