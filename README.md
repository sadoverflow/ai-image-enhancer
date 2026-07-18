# Browser ML Image Enhancer

Учебный проект: улучшение изображений по яркости, контрастности и цветности полностью в браузере пользователя. Инференс не уходит на сервер.

В основе лежит предобученная модель Image-Adaptive 3D LUT из репозитория `HuiZeng/Image-Adaptive-3DLUT`. Маленькая CNN предсказывает веса смешивания трех LUT-таблиц по уменьшенной копии изображения 256x256, а затем итоговый LUT применяется к полноразмерному изображению.

## Что уже реализовано

- клиентский ML-инференс в `Web Worker`;
- очередь задач с `taskId`, статусами, прогрессом, отменой и получением результата;
- публичный API `ImageEnhancer`;
- поддержка JPG, PNG, BMP и HEIC/HEIF;
- ограничение входа до 15 Мп;
- WebGL2-применение LUT с CPU fallback;
- экспорт весов модели и LUT из PyTorch-репозитория;
- production-сборка меньше 10 МБ.

## Запуск

```bash
npm install
npm run dev
```

Production-сборка и проверка размера:

```bash
npm run build
npm run check:size
```

## API

```ts
import { ImageEnhancer } from './src/ImageEnhancer';

const enhancer = new ImageEnhancer();

const taskId = enhancer.submit(file);

enhancer.onStatusChange((task) => {
  console.log(task.id, task.status, task.progress);
});

const status = enhancer.getStatus(taskId);
const resultBlob = await enhancer.getResult(taskId);

enhancer.cancel(taskId);
```

Статусы задачи: `queued`, `decoding`, `inferring`, `applying-lut`, `encoding`, `completed`, `cancelled`, `failed`.

## ML-модель

В браузере используется не ручной фильтр, а реальные веса предобученной Image-Adaptive 3D LUT:

- `public/models/classifier-weights.f32.bin` - веса CNN-предиктора;
- `public/models/classifier.json` - описание тензоров CNN;
- `public/models/lut-bases.f16.bin` - три базовые 3D LUT-таблицы;
- `public/models/lut-bases.json` - метаданные, commit upstream и SHA-256.

ONNX-файл создается скриптом экспорта как локальный проверочный артефакт. В финальный браузерный бандл он не включается, потому что стандартный `onnxruntime-web` вместе с WASM-рантаймом превышает лимит 10 МБ.

## Подготовка весов

Сначала локально клонируется upstream-репозиторий:

```bash
git clone https://github.com/HuiZeng/Image-Adaptive-3DLUT /private/tmp/image-adaptive-3dlut-upstream
```

Затем запускается экспорт:

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python export_predictor.py
```

Скрипт пишет браузерные ассеты в `public/models/`, а ONNX-проверку в `ml/artifacts/`.

## Публикация

Для GitHub Pages добавлен workflow `.github/workflows/deploy-pages.yml`. После пуша в ветку `main` он собирает проект с `VITE_BASE=/<repo-name>/`, проверяет размер `dist` и публикует демо.

Перед публикацией стоит проверить:

```bash
npm run build
npm run check:size
git status --short
```
