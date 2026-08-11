# OmniBox

OmniBox 是一个本地优先、面向 Windows 与 macOS 的桌面效率工具箱。文件转换、批量重命名、图片处理和大多数开发工具均由本机 Python 服务完成；只有明确切换到“AI 增强”或运行“需模型”工具时，才会调用用户配置的模型服务。

> 当前处于功能开发阶段，尚未发布正式 Release 或 Tag。`develop` 用于日常集成与构建验证，`main` 仅接收已经验证稳定的版本。
> 开发阶段统一保持产品版本 `0.1.0`，新增功能不调整版本号；开始正式发版后再按发布计划升级版本。

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
- PPT / 网页演示：从 Markdown、Word、Excel 或 PPTX 提取结构；提供 5 类汇报模板、9 套真实视觉预览、Excel 图表生成与内容质量检查，可导出单文件 HTML、演示 PDF 或可继续编辑的 PPTX
- 在线演示模板：应用只加载远程模板目录，用户选择后才下载模板 JSON；已下载模板可离线使用、更新或删除缓存，模板内容不会预置进安装包
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
- 超级剪贴板历史：应用运行时自动记录最近 50 次文本、浏览器图片、Finder/资源管理器图片文件与网页内嵌图片，支持搜索、重新复制、单条删除与一键清空；联网图片地址只作为文本保存，不自动下载
- 局域网网页快传：临时生成二维码，手机浏览器可直接上传原文件到指定目录，或下载电脑端明确选择的文件；不经过互联网、不压缩画质
- 文本长图：纯本地将 Markdown 或纯文本渲染为社交分享卡片，支持背景主题、自定义颜色、系统字体、金句样式、阴影、画布宽度与 PNG 导出

### 基金知识学习（P0）

- 首期按“基金是什么—常见类型—怎么赚亏—购买前检查—是否适合自己”组织 5 节零基础课程，本地仅包含目录骨架、检索关键词和权威来源清单
- 默认联网读取中国证监会、中国证券投资基金业协会网页，把专业内容整理成“入门问题—一句话理解—实际用途—现在怎么做”；监管原文默认折叠，可随时展开核对
- 配置模型后，可基于本次取得的权威原文临时生成更生活化的讲解、情景示例、常见误区和 2 道测验；课程正文与模型响应只保留在约 30 分钟的进程内存缓存中
- AI 测验由本地规则评分器完成，提交具备幂等保护；仅答案编号、得分、来源 ID、有效学习证据和概念掌握度保存在 `learning-user.db`
- 课程持续展示教育用途与风险边界，不接入真实账户、不推荐具体基金、不提供自动交易或收益承诺

### 大模型学习实验室（P0）

- 通用实验闭环：先写预测，再运行并检查中间步骤，最后用证据解释结论
- Tokenizer 可视化：Unicode Grapheme 与内置教学 BPE；教学结果不等同于商业模型 Tokenizer 或账单
- 小型 Attention：单 Head、`float64` 的 `QKᵀ → 缩放 → Mask → Softmax → 输出` 逐步计算
- RAG Debugger：纯本地 `omb-bm25-v1` 检索，显示排名和逐项 term contribution
- 运行记录与学习证据：可保存预测、参数、结构化结果和结论，并在页面查看最近记录；证据先以候选状态写入本机 `learning-user.db`
- Prompt Compare、Tool Calling、Eval Runner 已提供 JSON Schema Draft 2020-12 契约与黄金夹具，执行器将在后续 Spike 接入
- 所有 P0 实验契约默认拒绝未声明字段，并为错误提供原因、安全重试方式和停止条件

### 普通 / AI 双模式

- 文本翻译（有道智云、百度翻译开放平台 / AI 语义增强），支持自动语言检测、错选提示和英文美式/英式本地朗读
- 代码格式化与命名转换（可选 AI 语义命名）
- OCR 文字识别（本地 ONNX / AI 表格与 JSON 提取）
- Markdown 写作：打开和另存 `.md`，实时预览，导出 HTML、PDF、Word 和可编辑 PPTX（可选 AI 续写、目录、摘要）
- Excel / Word 助手：执行前先预览影响范围；支持 Excel 清理、工作表拆分/合并、工作簿差异对比，以及 Word 清理、批量替换、表格/图片提取；常用批处理可保存为纯本地复用方案，AI 处理仍只执行白名单计划并另存副本
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
- 演示导出：PptxGenJS + Electron 打印沙箱；视觉工作流参考 Frontend Slides（MIT）
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

在线演示模板目录默认读取 `https://raw.githubusercontent.com/Yicijiuhaobala/OmniBox/develop/templates/catalog.json`。仓库中的 `templates/` 是待托管资源，不会进入 Electron 安装包；只有用户选择的模板会下载到当前用户的 OmniBox 数据目录。开发或私有部署时可以通过 `OMNIBOX_TEMPLATE_CATALOG_URL` 指向同结构的 HTTPS 目录（本机调试允许 loopback HTTP）。

只验证前端或 Python 源码时可运行：

```bash
npm run test:learning
npm run build:web
python -m compileall -q backend
```

## 源码目录

```text
OmniBox/
├── backend/            # FastAPI 本地服务、文件、图像与学习数据持久化
├── build/              # electron-builder 所需最终图标
├── electron/           # Electron 主进程与 preload
├── public/             # 前端静态资源
├── src/                # React 界面、基金课程骨架、工具实现与大模型实验契约
├── templates/          # 在线演示模板目录与独立模板包，不进入安装包
├── tests/              # 本地确定性实验的黄金测试
├── docs/               # 产品需求、交互、数据与安全设计
├── package.json        # 开发、构建和打包脚本
└── vite.config.mjs     # Vite 配置
```

仓库不包含 `node_modules/`、Python 虚拟环境、`dist/`、`backend-dist/`、`release/`、`work/`、本地索引或验证截图。克隆后通过锁文件和依赖清单恢复环境即可。

## 隐私模型

1. 普通工具只调用随机避让端口上的 `127.0.0.1` 本地服务。
2. 文档摘要只发送本机提取的文档文字；AI OCR 会发送所选图片；Office 公式/自然语言处理只发送用户描述和有限的表名、样例与文档结构；其他 AI 工具只发送当前输入内容。
3. 普通工具中，IP 归属地会向 `ipwho.is` 发送待查询 IP；普通翻译会把原文发送到用户选择的有道或百度翻译服务。英文发音使用操作系统本地语音；图片缩放/选区修复/照片转 PDF、本地 OCR、Office 本地清理、证件水印、文本长图、超级剪贴板历史、Ping 和端口扫描不使用模型服务。
4. 超级剪贴板历史只在 OmniBox 运行时监听，最多保留 50 条、单张图片不超过 12 MB、全部历史不超过 100 MB；数据持久化在当前用户的 OmniBox 数据目录，类 Unix 系统文件权限设为 `600`。
5. API Key、有道与百度翻译凭据以明文保存在当前用户的本地配置文件中；设置页默认以密码形式显示，类 Unix 系统文件权限设为 `600`。
6. 基金课程正文和 AI 讲解不写入磁盘，仅在进程内存中短期缓存；测验只保存答案编号、得分、来源 ID、学习证据和概念掌握度。课程也不保存真实基金账户、身份证明或银行卡数据。
7. 大模型实验运行与候选学习证据保存在 `learning-user.db`，不写入 API Key、密码或服务 Token；类 Unix 系统数据库文件权限设为 `600`。
8. 本地 API 只监听 `127.0.0.1`，开发模式 CORS 仅允许 `localhost` 或 `127.0.0.1` 的 loopback 来源，不对局域网开放。只有用户主动开启“局域网网页快传”时，应用才会额外启动带随机令牌和自动到期时间的独立临时文件服务；停止分享、到期或退出应用后立即关闭。

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
