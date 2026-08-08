# OmniBox

OmniBox 是一个本地优先、面向 Windows 与 macOS 的桌面效率工具箱。文件转换、批量重命名、图片处理和大多数开发工具均由本机 Python 服务完成；只有明确切换到“AI 增强”或运行“需模型”工具时，才会调用用户配置的模型服务。

> 当前处于功能开发阶段，尚未发布正式 Release 或 Tag。`develop` 用于日常集成与构建验证，`main` 仅接收已经验证稳定的版本。

## 设计原则

- **本地优先**：能在本机完成的处理不上传文件。
- **双模式**：常用工具无需模型 Key；需要语义理解时可主动启用 AI。
- **可预期输出**：转换与清理默认另存副本，减少误覆盖风险。
- **跨平台构建**：Windows 与 macOS 分别生成原生后端和桌面安装包。

## 功能

### 文件批处理

- PDF、Word（DOCX）、Excel（XLSX）批量摘要：本机提取文字，逐份生成 Markdown 摘要
- 格式转换：PDF/Word/Excel 转 TXT、Excel 转 CSV、CSV 转 Excel、TXT 转 Word
- Word/Excel 转 PDF：检测并调用本机 LibreOffice，未安装时给出明确提示
- 批量重命名：支持 `{name}`、`{n}`、`{n:03}`、`{ext}` 模板和执行前预览
- 转换始终输出到新目录；重命名默认创建副本，也可选择原地修改

### 本地开发与日常工具

- JSON、YAML、XML 格式化、压缩、语法检查与可展开节点树
- JSON Schema Draft 2020-12 校验与字段路径错误列表
- Base64、URL 编解码，JWT Header/Payload 本地解码（不验证签名）
- MD5、SHA-256、SHA-512 哈希计算与摘要校验
- Unix 时间戳与日期互转，IANA 时区和 Cron 未来 10 次执行时间预测
- 文本按行去重、排序、统一 Diff、带高亮和捕获组的正则测试
- PNG、JPG、WebP、SVG 格式转换，选择图片后显示原始宽高，支持缩放、裁剪和 EXIF 清理
- 本地选区修复：按矩形坐标移除本人有权编辑图片中的水印或瑕疵
- 多张照片按顺序合并为 PDF：支持 A4 自动横竖版或原图尺寸，保持比例且不裁切
- PNG/WebP 无损重压缩，JPG 无损移除 EXIF/注释数据
- IP 归属地、Ping、最多 100 个端口的 TCP Connect 扫描
- 屏幕吸色与 HEX、RGB、HSL 颜色格式转换
- UUID、安全随机密码批量生成

### 普通 / AI 双模式

- 文本翻译（有道智云、百度翻译开放平台 / AI 语义增强），支持自动语言检测、错选提示和英文美式/英式本地朗读
- 代码格式化与命名转换（可选 AI 语义命名）
- OCR 文字识别（本地 ONNX / AI 表格与 JSON 提取）
- Markdown 写作、实时预览与 PDF 导出（可选 AI 续写、目录、摘要）
- Excel / Word 助手：白话生成公式、本地清理空行/重复行/空段落/人工分页，或由 AI 生成白名单计划后在本机另存副本
- Prompt 调试与优化：扩展为 System Prompt、Context、Few-Shot、用户模板与检查清单
- 证件防盗用水印：纯本地为身份证、营业执照等图片铺满半透明自定义水印，并清除原图元数据
- 全局白天 / 黑夜主题：跟随系统首次选择，并记住用户切换结果

### 需要 AI Key

- 智能润色
- 内容总结
- 结构化信息提取
- 代码解释
- 内容起草

当前支持 OpenAI、DeepSeek、硅基流动，以及任意兼容 OpenAI Chat Completions 格式的自定义接口。AI Key、有道与百度翻译凭据保存在当前用户的本地配置文件中，设置页默认以密码形式显示，也可手动切换为明文。OmniBox 不再访问 macOS Keychain 或 Windows Credential Manager；请注意这些凭据在配置文件中是明文，类 Unix 系统会将文件权限设为 `600`。

## 技术栈

- 桌面外壳：Electron
- 前端：React + Vite + Framer Motion + Lucide
- 本地后端：Python + FastAPI
- Python 打包：PyInstaller
- 桌面安装包：electron-builder

## 快速开始

### 环境要求

- Node.js 20.19+ 或 22.12+
- Python 3.11 或 3.12
- npm 10+
- 构建 Word/Excel 转 PDF 功能时，建议安装 LibreOffice

### macOS / Linux 开发环境

```bash
git clone -b develop https://github.com/Yicijiuhaobala/OmniBox.git
cd OmniBox
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm ci
npm run dev
```

### Windows PowerShell 开发环境

```powershell
git clone -b develop https://github.com/Yicijiuhaobala/OmniBox.git
Set-Location OmniBox
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
npm ci
npm run dev
```

开发模式会同时启动 Vite、Electron 和仅监听 `127.0.0.1:8000` 的 FastAPI 服务。

## 服务配置

首次启动后可在设置页按需配置：

- AI 服务：OpenAI、DeepSeek、硅基流动或兼容 OpenAI Chat Completions 的自定义服务
- 普通翻译：有道智云或百度翻译开放平台

这些凭据只保存在当前用户的本地配置文件中，设置页默认以密码形式展示。OmniBox 不访问 macOS Keychain 或 Windows Credential Manager；请勿提交个人配置、`.env` 或日志文件。

## 构建安装包

macOS 安装包必须在 macOS 上构建：

```bash
source .venv/bin/activate
npm run build:mac
```

Windows 安装包必须在 Windows 上构建：

```powershell
.venv\Scripts\Activate.ps1
npm run build:win
```

产物位于 `release/`。这是因为 PyInstaller 生成的平台原生 Python 可执行文件不能跨系统直接构建。正式发布时，建议使用 GitHub Actions 的 macOS 与 Windows runner 分别构建并签名。

只验证前端或 Python 源码时可运行：

```bash
npm run build:web
python -m compileall -q backend
```

## 源码目录

```text
OmniBox/
├── backend/            # FastAPI 本地服务、文件与图像处理
├── build/              # electron-builder 所需最终图标
├── electron/           # Electron 主进程与 preload
├── public/             # 前端静态资源
├── src/                # React 界面与工具实现
├── package.json        # 开发、构建和打包脚本
└── vite.config.mjs     # Vite 配置
```

仓库不包含 `node_modules/`、Python 虚拟环境、`dist/`、`backend-dist/`、`release/`、`work/`、本地索引或验证截图。克隆后通过锁文件和依赖清单恢复环境即可。

## 隐私模型

1. 普通工具只调用随机避让端口上的 `127.0.0.1` 本地服务。
2. 文档摘要只发送本机提取的文档文字；AI OCR 会发送所选图片；Office 公式/自然语言处理只发送用户描述和有限的表名、样例与文档结构；其他 AI 工具只发送当前输入内容。
3. 普通工具中，IP 归属地会向 `ipwho.is` 发送待查询 IP；普通翻译会把原文发送到用户选择的有道或百度翻译服务。英文发音使用操作系统本地语音；图片缩放/选区修复/照片转 PDF、本地 OCR、Office 本地清理、证件水印、Ping 和端口扫描不使用模型服务。
4. API Key、有道与百度翻译凭据以明文保存在当前用户的本地配置文件中；设置页默认以密码形式显示，类 Unix 系统文件权限设为 `600`。
5. 本地 API 只监听 `127.0.0.1`，不对局域网开放。

## 分支与发布策略

- `develop`：功能开发、集成与跨平台构建验证。
- `main`：稳定主分支，只从验证通过的 `develop` 同步。
- Release / Tag：当前暂不创建，待核心功能和安装包达到稳定状态后再启用。

建议从 `develop` 创建功能分支，完成验证后先合并回 `develop`；准备稳定版本时再由 `develop` 合并到 `main`。

## 后续方向

- 图片背景移除与可视化画笔选区
- 工作流：把多个工具串联成可保存的一键流程
- 插件系统：允许独立安装新工具，不必更新整个应用
- 自动更新、崩溃日志、安装包签名与发布流水线

## License

本项目采用 [Apache License 2.0](LICENSE) 许可证。
