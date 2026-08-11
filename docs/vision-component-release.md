# 本地视觉组件发布

本地视觉组件承载 RapidOCR、ONNX Runtime、OpenCV 与 OCR 模型，不进入 OmniBox 基础安装包。OCR 和图片选区修复首次使用时共享下载一次，安装后完全离线运行。

## 构建

```bash
npm run build:vision
```

构建结果位于 `component-dist/vision/`：

- `omnibox-vision-runtime-<platform>-<arch>`：需要上传的组件文件；
- `catalog.json`：包含平台、版本、下载地址、大小和 SHA-256；
- `release-info.json`：GitHub Release 标签和上传信息。

## 发布

1. 使用 `release-info.json` 中的 `releaseTag` 创建 GitHub Release。
2. 上传其中 `asset` 指定的文件，文件名不能改变。
3. 合并各平台生成的 `catalog.json`，并与组件文件上传到同一个 Release。
4. 发布后分别检查目录 URL、Release Asset URL 和 SHA-256。

默认目录地址为：

```text
https://github.com/Yicijiuhaobala/OmniBox/releases/download/vision-runtime-v1.0.0/catalog.json
```

本地联调可设置：

```bash
OMNIBOX_VISION_CATALOG_URL=http://127.0.0.1:18765/catalog.json
```

只有回环地址允许使用 HTTP，正式组件必须使用 HTTPS。下载完成后核心后端会依次校验文件大小、SHA-256 和组件协议，任何一步失败都不会写入当前安装记录。
