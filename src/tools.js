import {
  Braces, Binary, KeyRound, Clock3, Regex, Image, Network,
  Sparkles, ScanText, Languages, ListCollapse, Code2, PenLine,
  FileSearch, Files, FileOutput, CaseSensitive, ScanLine, NotebookPen, ShieldCheck, ClipboardList, GalleryVerticalEnd, BrainCircuit, PiggyBank,
  ServerOff, HardDrive, RadioTower, Presentation,
} from 'lucide-react'

export const tools = [
  {
    id: 'fund_learning', type: 'fund_learning', title: '基金零基础入门', subtitle: '从“基金是什么”开始学',
    description: '用实际问题和操作清单学习中国公募基金基础，不背法规，不堆专业术语。', icon: PiggyBank,
    color: 'orange', category: 'learning',
  },
  {
    id: 'llm_lab', type: 'learning', title: '大模型实验室', subtitle: '从可复算实验理解核心机制',
    description: '通过 Tokenizer、Attention、RAG、Prompt、Tool Calling 与 Eval 实验建立大模型应用基础。', icon: BrainCircuit,
    color: 'blue', category: 'learning',
  },
  {
    id: 'file_summary', type: 'file', title: '文档摘要', subtitle: '批量提炼 PDF、Word、Excel',
    description: '在本机读取文档文字，再用你配置的模型逐份生成摘要。', icon: FileSearch,
    color: 'blue', fileKind: 'summary', requiresAI: true,
  },
  {
    id: 'file_convert', type: 'file', title: '格式转换', subtitle: '文档与表格批量转换',
    description: '支持 PDF/Word 转 TXT、Excel 转 CSV、CSV 转 Excel、TXT 转 Word。', icon: FileOutput,
    color: 'green', fileKind: 'convert',
  },
  {
    id: 'batch_rename', type: 'file', title: '批量重命名', subtitle: '规则预览后一次完成',
    description: '通过名称、序号和扩展名模板批量整理文件，默认保留源文件。', icon: Files,
    color: 'orange', fileKind: 'any',
  },
  {
    id: 'clipboard_history', type: 'clipboard', title: '超级剪贴板历史', subtitle: '最近 50 次文本与图片复制',
    description: '在本机自动记录最近复制的文本和图片，支持搜索、重新复制、删除与一键清空。', icon: ClipboardList,
    color: 'cyan', category: 'system',
  },
  {
    id: 'port_killer', type: 'system', title: '端口占用一键杀死', subtitle: '查询并终止本机监听进程',
    description: '输入端口查看占用进程，确认后安全终止；自动保护 OmniBox 自身服务。', icon: ServerOff,
    color: 'orange', category: 'system',
  },
  {
    id: 'storage_cleaner', type: 'system', title: '设备存储清理', subtitle: '扫描缓存、日志与个人目录大文件',
    description: '扫描缓存、日志和桌面、文档、下载目录大文件，再按所选类别安全处理。', icon: HardDrive,
    color: 'green', category: 'system',
  },
  {
    id: 'lan_transfer', type: 'system', title: '局域网网页快传', subtitle: '手机扫码上传或下载原文件',
    description: '启动隔离的临时局域网服务，手机扫码后直接传输文件，不经过互联网。', icon: RadioTower,
    color: 'cyan', category: 'system',
  },
  {
    id: 'presentation_studio', type: 'presentation', title: 'PPT / 网页演示', subtitle: '在线模板、9 套主题与 Excel 图表',
    description: '按需下载汇报模板，从 Markdown、Word、Excel 或 PPTX 生成演示并导出 HTML、PDF 或可编辑 PPTX。', icon: Presentation,
    color: 'orange', category: 'content',
  },
  {
    id: 'translate', type: 'hybrid', title: '文本翻译', subtitle: '有道 / 百度翻译与语义增强',
    description: '可选择有道或百度开放平台进行普通翻译，也可启用模型进行语境化、风格化翻译。', icon: Languages,
    color: 'cyan', category: 'content',
  },
  {
    id: 'code_studio', type: 'hybrid', title: '代码格式化与命名', subtitle: '格式整理、命名转换与语义命名',
    description: '本地格式化代码、转换 CamelCase / snake_case，或根据业务语义生成名称。', icon: CaseSensitive,
    color: 'green', category: 'content',
  },
  {
    id: 'ocr', type: 'hybrid', title: 'OCR 文字识别', subtitle: '本地识别与结构化提取',
    description: '图片默认在本机识别；启用模型后可纠错并提取为表格或 JSON。', icon: ScanLine,
    color: 'orange', category: 'content', fileKind: 'images',
  },
  {
    id: 'markdown', type: 'hybrid', title: 'Markdown 写作', subtitle: '打开、编辑并导出多种办公格式',
    description: '打开和另存 Markdown，本地实时预览并导出 HTML、PDF、Word 或可编辑 PPTX。', icon: NotebookPen,
    color: 'blue', category: 'content',
  },
  {
    id: 'social_card', type: 'card', title: '文本长图', subtitle: 'Markdown 转社交分享卡片',
    description: '将文本或 Markdown 在本机排版为长图，选择背景、字体、阴影和金句样式后导出 PNG。', icon: GalleryVerticalEnd,
    color: 'pink', category: 'content',
  },
  {
    id: 'office_assistant', type: 'hybrid', title: 'Excel / Word 助手', subtitle: '批处理、预览与可复用方案',
    description: '预览后再清理、拆分、合并或对比文件，并将常用批处理配置保存为本地方案。', icon: Files,
    color: 'green', category: 'content', fileKind: 'office',
  },
  {
    id: 'structured', type: 'advanced', title: 'JSON / YAML / XML', subtitle: '格式、校验与树形查看',
    description: '格式化、压缩、语法检查、节点树与 JSON Schema 校验。', icon: Braces,
    color: 'green', category: 'data',
  },
  {
    id: 'codec', type: 'advanced', title: '编解码与哈希', subtitle: 'Base64、URL、JWT、摘要校验',
    description: '集中处理常见编码、JWT 本地解码和 MD5/SHA 哈希校验。', icon: Binary,
    color: 'orange', category: 'data',
  },
  {
    id: 'time_cron', type: 'advanced', title: '时间戳与 Cron', subtitle: '时区转换与未来执行时间',
    description: 'Unix 时间戳互转，校验 Cron 并预测未来 10 次执行时间。', icon: Clock3,
    color: 'cyan', category: 'data',
  },
  {
    id: 'text_regex', type: 'advanced', title: '文本与正则', subtitle: '去重、排序、Diff、匹配高亮',
    description: '批量整理文本、比较差异并可视化检查正则匹配结果。', icon: Regex,
    color: 'blue', category: 'data',
  },
  {
    id: 'image_local', type: 'advanced', title: '图像本地处理', subtitle: '缩放、选区修复与照片转 PDF',
    description: '批量转换、压缩、缩放、裁剪、修复选区或把多张照片合并为 PDF。', icon: Image,
    color: 'pink', category: 'system',
  },
  {
    id: 'identity_watermark', type: 'advanced', title: '证件防盗用水印', subtitle: '纯本地铺满自定义水印',
    description: '为身份证、营业执照等图片批量添加半透明水印，绝不上传云端。', icon: ShieldCheck,
    color: 'orange', category: 'system', fileKind: 'identity_images',
  },
  {
    id: 'network_system', type: 'advanced', title: '网络与颜色', subtitle: 'IP、Ping、端口与吸色盘',
    description: '常用网络诊断与颜色拾取、HEX/RGB/HSL 格式转换。', icon: Network,
    color: 'violet', category: 'system',
  },
  {
    id: 'prompt_optimizer', type: 'ai', title: 'Prompt 调试与优化', subtitle: '结构化提示词与 Few-Shot 示例',
    description: '把简单要求扩展为 System Prompt、Context、Few-Shot 和可复用模板。', icon: Sparkles,
    color: 'violet', placeholder: '例如：帮我写一个分析客户访谈记录的 Prompt…',
    instructionPlaceholder: '例如：适配客服质检场景，输出 JSON，并避免臆测',
  },
  {
    id: 'polish', type: 'ai', title: '智能润色', subtitle: '让表达更清晰、更专业',
    description: '优化措辞、逻辑和语气，同时忠实保留你的原意。', icon: Sparkles,
    color: 'violet', placeholder: '粘贴需要润色的文字…',
    instructionPlaceholder: '例如：更简洁，适合给客户发送',
  },
  {
    id: 'summarize', type: 'ai', title: '内容总结', subtitle: '长内容快速抓重点',
    description: '从文章、会议记录或资料中提炼核心结论和行动项。', icon: ListCollapse,
    color: 'blue', placeholder: '粘贴文章、会议记录或其他长内容…',
    instructionPlaceholder: '例如：输出 5 个要点，并列出行动项',
  },
  {
    id: 'extract', type: 'ai', title: '信息提取', subtitle: '把杂乱内容变成结构',
    description: '自动识别人名、日期、数字、任务、风险等关键信息。', icon: ScanText,
    color: 'orange', placeholder: '粘贴需要整理的信息…',
    instructionPlaceholder: '例如：整理成 Markdown 表格',
  },
  {
    id: 'explain_code', type: 'ai', title: '代码解释', subtitle: '读懂陌生代码与风险',
    description: '解释代码流程、关键设计、潜在问题和可行的改进方向。', icon: Code2,
    color: 'green', placeholder: '粘贴代码片段…',
    instructionPlaceholder: '例如：重点解释并发安全问题',
  },
  {
    id: 'draft', type: 'ai', title: '内容起草', subtitle: '从想法快速生成初稿',
    description: '根据零散材料生成邮件、方案、说明、社交文案等成稿。', icon: PenLine,
    color: 'pink', placeholder: '描述你想写的内容，并提供必要信息…',
    instructionPlaceholder: '例如：写成一封 300 字以内的正式邮件',
  },
  {
    id: 'generate', type: 'basic', title: '安全生成器', subtitle: 'UUID 与高强度密码',
    description: '使用系统安全随机源，批量生成 UUID 或随机密码。', icon: KeyRound,
    color: 'pink', placeholder: '这个工具无需输入内容',
    actions: [['uuid', 'UUID'], ['password', '安全密码']], noInput: true,
  },
]

export const aiTools = tools.filter((tool) => tool.type === 'ai')
export const basicTools = tools.filter((tool) => tool.type === 'basic')
export const fileTools = tools.filter((tool) => tool.type === 'file')
export const clipboardTools = tools.filter((tool) => tool.type === 'clipboard')
export const advancedTools = tools.filter((tool) => tool.type === 'advanced')
export const hybridTools = tools.filter((tool) => tool.type === 'hybrid')
export const cardTools = tools.filter((tool) => tool.type === 'card')
export const learningTools = tools.filter((tool) => ['learning', 'fund_learning'].includes(tool.type))
export const systemTools = tools.filter((tool) => tool.type === 'system')
export const presentationTools = tools.filter((tool) => tool.type === 'presentation')
