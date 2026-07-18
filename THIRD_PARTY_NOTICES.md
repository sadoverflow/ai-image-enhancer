# Third-party notices

## Image-Adaptive-3DLUT

This project distributes converted pretrained sRGB assets from:

- Repository: https://github.com/HuiZeng/Image-Adaptive-3DLUT
- Upstream commit: `b491f6df64a588864739a157db271e5c848e1805`
- Upstream license: Apache License 2.0

Distributed converted artefacts:

- `public/models/classifier.json`
  SHA-256: `63c8daee7246a47c76dd08c467421727f2dcd447722c1faf8649ab04eeca74e7`
- `public/models/classifier-weights.f32.bin`
  SHA-256: `c8c8f863c129360d2f896a5aef22329f4275813b7764e568f95b0474c797991c`
- `public/models/lut-bases.json`
  SHA-256: `b129eff0621c63e216812cd92e41149c7fdd8cddbadbbfd67bf1e1378d2b7c0b`
- `public/models/lut-bases.f16.bin`
  SHA-256: `14688a0ea4a3f1fe534ab71d735abe5b5391f5cd8d86dfeed74b391fe1eb56cb`

The conversion script is `ml/export_predictor.py`. It exports the CNN weights and basis LUTs for browser use, and creates an ONNX file only for local PyTorch-vs-ONNX verification.

## heic2any

HEIC/HEIF decoding in the browser is handled by the npm package `heic2any`.
