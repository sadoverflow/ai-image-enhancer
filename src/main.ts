import './style.css';
import { ImageEnhancer } from './ImageEnhancer';

const enhancer = new ImageEnhancer();
const input = el<HTMLInputElement>('file-input');
const dropZone = el<HTMLElement>('drop-zone');
const status = el<HTMLElement>('status-label');
const progress = el<HTMLElement>('progress-bar');
const abortBtn = el<HTMLButtonElement>('abort-button');
const preview = el<HTMLElement>('preview-section');
const sourceImg = el<HTMLImageElement>('source-preview');
const resultImg = el<HTMLImageElement>('result-preview');
const download = el<HTMLAnchorElement>('download-link');
const errorBox = el<HTMLElement>('error-message');

let taskId: string | undefined;
let sourceUrl: string | undefined;
let resultUrl: string | undefined;
let inputRun = 0;

input.onchange = () => {
  const file = input.files?.[0];
  if (file) process(file);
};

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag'); };
dropZone.ondragleave = () => dropZone.classList.remove('drag');
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  const file = e.dataTransfer?.files[0];
  if (file) process(file);
};

abortBtn.onclick = () => { if (taskId) enhancer.cancel(taskId); };

enhancer.onStatusChange((task) => {
  if (task.id !== taskId) return;
  progress.style.width = `${task.progress}%`;
  status.textContent = label(task.status, task.progress);
  abortBtn.disabled = ['completed', 'cancelled', 'failed'].includes(task.status);
  if (task.status === 'failed') showError(task.error ?? 'Ошибка обработки.');
  if (task.status === 'cancelled') status.textContent = 'Отменено';
});

async function process(file: File): Promise<void> {
  const run = inputRun + 1;
  inputRun = run;
  resetUrls();
  hideError();
  preview.hidden = false;
  sourceUrl = URL.createObjectURL(file);
  sourceImg.src = sourceUrl;
  resultImg.removeAttribute('src');
  download.hidden = true;

  const currentTaskId = enhancer.submit(file);
  taskId = currentTaskId;
  abortBtn.disabled = false;
  try {
    const blob = await enhancer.getResult(currentTaskId);
    if (run !== inputRun || taskId !== currentTaskId) return;
    resultUrl = URL.createObjectURL(blob);
    resultImg.src = resultUrl;
    download.href = resultUrl;
    download.download = `result.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
    download.hidden = false;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    showError(e instanceof Error ? e.message : 'Не удалось получить результат.');
  }
}

function label(status: string, pct: number): string {
  const map: Record<string, string> = {
    queued: 'В очереди',
    decoding: 'Загрузка',
    inferring: 'Анализ',
    'applying-lut': 'Коррекция',
    encoding: 'Сохранение',
    completed: 'Готово',
  };
  return `${map[status] ?? status} — ${pct}%`;
}

function resetUrls(): void {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  sourceUrl = undefined;
  resultUrl = undefined;
}

function showError(msg: string): void {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

function hideError(): void {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} не найден`);
  return node as T;
}
