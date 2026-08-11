import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Check, Clipboard, Cpu, Eye, EyeOff, Home, KeyRound, LoaderCircle, LockKeyhole,
  Menu, Search, Settings, ShieldCheck, Sparkles, X, Boxes, FolderOpen, Moon, Sun,
  FilePlus2, Trash2, Play, Copy,
} from 'lucide-react'
import { api } from './api'
import { advancedTools, aiTools, basicTools, cardTools, clipboardTools, fileTools, hybridTools, learningTools, presentationTools, systemTools, tools } from './tools'

const AdvancedToolPage = lazy(() => import('./AdvancedTools'))
const ClipboardHistoryPage = lazy(() => import('./ClipboardHistory'))
const HybridToolPage = lazy(() => import('./HybridTools'))
const SocialCardPage = lazy(() => import('./SocialCard'))
const LLMLabPage = lazy(() => import('./LLMLab'))
const FundLearningPage = lazy(() => import('./FundLearning'))
const SystemToolPage = lazy(() => import('./SystemTools'))
const PresentationStudio = lazy(() => import('./PresentationStudio'))

const providerPresets = {
  openai: { label: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  deepseek: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  siliconflow: { label: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B' },
  custom: { label: '自定义兼容接口', base_url: '', model: '' },
}

function App() {
  const [page, setPage] = useState('home')
  const [activeTool, setActiveTool] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [translationServices, setTranslationServices] = useState({ youdao: false, baidu: false })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('omnibox-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('omnibox-theme', theme)
    window.desktop?.setTheme?.(theme)
  }, [theme])

  useEffect(() => {
    Promise.all([api.health(), api.settings()])
      .then(([, settings]) => {
        setApiReady(true)
        setConfigured(settings.has_api_key)
        setTranslationServices({ youdao: settings.has_youdao_credentials, baidu: settings.has_baidu_credentials })
      })
      .catch(() => setApiReady(false))

    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectTool = (tool) => {
    setActiveTool(tool)
    setPage('tool')
    setSearchOpen(false)
    setSidebarOpen(false)
  }

  const goHome = () => {
    setPage('home')
    setActiveTool(null)
    setSidebarOpen(false)
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        open={sidebarOpen}
        goHome={goHome}
        openSearch={() => setSearchOpen(true)}
        openSettings={() => setSettingsOpen(true)}
        selectTool={selectTool}
      />
      <main className="main-panel">
        <Topbar
          apiReady={apiReady}
          onMenu={() => setSidebarOpen((value) => !value)}
          onSearch={() => setSearchOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
        />
        <AnimatePresence mode="wait">
          {page === 'home' ? (
            <HomePage key="home" configured={configured} selectTool={selectTool} openSettings={() => setSettingsOpen(true)} />
          ) : <Suspense key={activeTool?.id || 'tool'} fallback={<div className="route-loading"><LoaderCircle className="spin" size={20} /><span>正在打开工具…</span></div>}>
            {
            activeTool?.type === 'fund_learning' ? (
              <FundLearningPage key={activeTool.id} tool={activeTool} configured={configured} openSettings={() => setSettingsOpen(true)} goHome={goHome} />
            ) : activeTool?.type === 'learning' ? (
              <LLMLabPage key={activeTool.id} tool={activeTool} goHome={goHome} />
            ) : activeTool?.type === 'clipboard' ? (
              <ClipboardHistoryPage key={activeTool.id} tool={activeTool} goHome={goHome} />
            ) : activeTool?.type === 'system' ? (
              <SystemToolPage key={activeTool.id} tool={activeTool} goHome={goHome} />
            ) : activeTool?.type === 'presentation' ? (
              <PresentationStudio key={activeTool.id} tool={activeTool} configured={configured} openSettings={() => setSettingsOpen(true)} goHome={goHome} />
            ) : activeTool?.type === 'file' ? (
              <FileToolPage key={activeTool.id} tool={activeTool} configured={configured} openSettings={() => setSettingsOpen(true)} goHome={goHome} />
            ) : activeTool?.type === 'advanced' ? (
              <AdvancedToolPage key={activeTool.id} tool={activeTool} goHome={goHome} />
            ) : activeTool?.type === 'hybrid' ? (
              <HybridToolPage key={activeTool.id} tool={activeTool} configured={configured} translationServices={translationServices} openSettings={() => setSettingsOpen(true)} goHome={goHome} />
            ) : activeTool?.type === 'card' ? (
              <SocialCardPage key={activeTool.id} tool={activeTool} goHome={goHome} />
            ) : (
              <ToolPage key={activeTool?.id} tool={activeTool} configured={configured} openSettings={() => setSettingsOpen(true)} goHome={goHome} />
            )
            }
          </Suspense>}
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} selectTool={selectTool} />}
        {settingsOpen && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            onSaved={({ hasKey, hasYoudao, hasBaidu }) => { setConfigured(hasKey); setTranslationServices({ youdao: hasYoudao, baidu: hasBaidu }) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Sidebar({ page, open, goHome, openSearch, openSettings, selectTool }) {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark"><img src="./omnibox-icon.png" alt="" /></div>
        <div><div className="brand-name">OmniBox</div><div className="brand-version">桌面工具箱</div></div>
      </div>
      <button className="quick-search" onClick={openSearch}>
        <Search size={16} /><span>搜索工具</span><kbd>⌘ K</kbd>
      </button>
      <nav className="sidebar-nav">
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={goHome}>
          <Home size={17} /><span>首页</span>
        </button>
        <div className="nav-label">学习中心</div>
        {learningTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        <div className="nav-label">文件处理</div>
        {fileTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        <div className="nav-label">开发与数据</div>
        {advancedTools.filter((tool) => tool.category === 'data').map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        <div className="nav-label">图像与系统</div>
        {clipboardTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        {systemTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        {advancedTools.filter((tool) => tool.category === 'system').map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        {basicTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        <div className="nav-label">写作与识别</div>
        {presentationTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        {cardTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        {hybridTools.map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
        <div className="nav-label">内容工具</div>
        {aiTools.slice(0, 3).map((tool) => <SidebarTool key={tool.id} tool={tool} onClick={() => selectTool(tool)} />)}
      </nav>
      <div className="sidebar-footer">
        <button className="nav-item" onClick={openSettings}><Settings size={17} /><span>服务与设置</span></button>
        <div className="local-badge"><ShieldCheck size={14} /><span>本地文件，本地处理</span></div>
      </div>
    </aside>
  )
}

function SidebarTool({ tool, onClick }) {
  const Icon = tool.icon
  return <button className="nav-item" onClick={onClick}><Icon size={17} /><span>{tool.title}</span>{tool.type === 'hybrid' ? <span className="mini-ai">双模式</span> : (tool.type === 'ai' || tool.requiresAI) && <span className="mini-ai">模型</span>}</button>
}

function Topbar({ apiReady, onMenu, onSearch, onSettings, theme, onToggleTheme }) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu}><Menu size={18} /></button>
      <div className="history-buttons"><button disabled><ArrowLeft size={16} /></button><button disabled><ArrowRight size={16} /></button></div>
      <button className="top-search" onClick={onSearch}><Search size={15} /><span>快速找到你需要的工具</span></button>
      <div className="top-actions">
        <div className={`service-status ${apiReady ? 'online' : ''}`}><span />{apiReady ? '本地服务正常' : '服务未连接'}</div>
        <button className="icon-button theme-toggle" onClick={onToggleTheme} aria-label={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'} title={theme === 'dark' ? '白天模式' : '黑夜模式'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="icon-button" onClick={onSettings}><Settings size={17} /></button>
      </div>
    </header>
  )
}

function HomePage({ configured, selectTool, openSettings }) {
  return (
    <motion.div className="page-scroll home-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="hero">
        <div className="eyebrow">OMNIBOX / DESKTOP UTILITIES</div>
        <h1>文件和日常工具，<br />集中在一个地方。</h1>
        <p>批量处理文档与文件，也提供常用的文本、数据和内容工具。</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => selectTool(fileTools[0])}>选择文件 <ArrowRight size={17} /></button>
          <button className="secondary-button" onClick={openSettings}><Settings size={16} />{configured ? '模型已连接' : '连接摘要模型'}</button>
        </div>
        <div className="hero-meta"><span>PDF / DOCX / XLSX</span><span>源文件保护</span><span>批量执行</span></div>
      </section>

      <SectionHeader eyebrow="LEARN" title="学习实验室" description="用可复算实验理解机制，先预测、再运行、最后解释。" />
      <div className="tool-grid file-grid">
        {learningTools.map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} onClick={() => selectTool(tool)} />)}
      </div>

      <SectionHeader eyebrow="FILES" title="文件批处理" description="选择多个文件，检查预览后一次执行。" />
      <div className="tool-grid file-grid">
        {fileTools.map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} onClick={() => selectTool(tool)} />)}
      </div>

      <SectionHeader eyebrow="UTILITIES" title="开发与日常工具" description="格式校验、编解码、文本、图片与网络诊断。" />
      <div className="tool-grid basic-grid">
        {[...clipboardTools, ...systemTools, ...advancedTools, ...basicTools].map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} onClick={() => selectTool(tool)} />)}
      </div>

      <SectionHeader eyebrow="CREATE" title="写作、翻译与识别" description="优先使用本地或专用服务，需要语义理解时再启用模型。" />
      <div className="tool-grid hybrid-grid-cards">
        {[...presentationTools, ...cardTools, ...hybridTools].map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} onClick={() => selectTool(tool)} />)}
      </div>

      <SectionHeader eyebrow="WRITING" title="内容工具" description="仅这些工具会使用你连接的模型服务。" />
      <div className="tool-grid ai-grid">{aiTools.map((tool, index) => <ToolCard key={tool.id} tool={tool} index={index} onClick={() => selectTool(tool)} />)}</div>
    </motion.div>
  )
}

function SectionHeader({ eyebrow, title, description }) {
  return <div className="section-heading">{eyebrow && <span>{eyebrow}</span>}<div><h2>{title}</h2><p>{description}</p></div></div>
}

function ToolCard({ tool, index, onClick }) {
  const Icon = tool.icon
  return (
    <motion.button className="tool-card" onClick={onClick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.025 }}>
      <div className={`tool-icon ${tool.color}`}><Icon size={21} /></div>
      <div className="card-title"><h3>{tool.title}</h3>{tool.type === 'hybrid' ? <span>可选增强</span> : (tool.type === 'ai' || tool.requiresAI) && <span>需模型</span>}</div>
      <p>{tool.subtitle}</p>
      <div className="card-arrow"><ArrowRight size={15} /></div>
    </motion.button>
  )
}

function ToolPage({ tool, configured, openSettings, goHome }) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [instruction, setInstruction] = useState('')
  const [action, setAction] = useState(tool?.actions?.[0]?.[0] || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [count, setCount] = useState(5)
  const [length, setLength] = useState(20)
  const Icon = tool.icon

  const run = async () => {
    if (!tool.noInput && !input.trim()) return setError('请先输入需要处理的内容')
    if (tool.type === 'ai' && !configured) return openSettings()
    setLoading(true); setError(''); setOutput('')
    try {
      const data = tool.type === 'ai'
        ? await api.runAI({ tool: tool.id, input, instruction })
        : await api.runBasic({ tool: tool.id, action, input, options: { count, length } })
      setOutput(data.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (window.desktop?.copyText) window.desktop.copyText(output)
    else await navigator.clipboard.writeText(output)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }

  return (
    <motion.div className="page-scroll tool-page" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
      <div className="tool-heading-row">
        <div className={`tool-icon large ${tool.color}`}><Icon size={27} /></div>
        <div><div className="title-with-badge"><h1>{tool.title}</h1>{tool.type === 'ai' && <span className="ai-badge">需模型</span>}</div><p>{tool.description}</p></div>
      </div>

      <div className="workspace-card">
        {tool.type === 'ai' && !configured && (
          <button className="config-notice" onClick={openSettings}><KeyRound size={17} /><span><strong>需要连接模型</strong>添加 API Key 后即可运行此工具</span><ArrowRight size={16} /></button>
        )}
        {tool.actions && (
          <div className="action-tabs">
            {tool.actions.map(([value, label]) => <button key={value} className={action === value ? 'active' : ''} onClick={() => setAction(value)}>{label}</button>)}
          </div>
        )}
        {tool.noInput ? (
          <div className="generator-options">
            <label>生成数量<input type="number" min="1" max="50" value={count} onChange={(event) => setCount(event.target.value)} /></label>
            {action === 'password' && <label>密码长度<input type="number" min="8" max="128" value={length} onChange={(event) => setLength(event.target.value)} /></label>}
          </div>
        ) : (
          <div className="editor-block">
            <div className="editor-label"><span>输入内容</span><span>{input.length.toLocaleString()} 字符</span></div>
            <textarea className={tool.id === 'explain_code' || tool.id === 'json' ? 'code-editor' : ''} value={input} onChange={(event) => setInput(event.target.value)} placeholder={tool.placeholder} spellCheck="false" />
          </div>
        )}
        {tool.type === 'ai' && (
          <div className="instruction-row"><Sparkles size={15} /><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={tool.instructionPlaceholder} /></div>
        )}
        {error && <div className="error-message">{error}</div>}
        <div className="run-row">
          <span>{tool.type === 'ai' ? '内容会发送至你配置的模型服务' : '处理过程完全在本机完成'}</span>
          <button className="primary-button" onClick={run} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17} />处理中</> : <>{tool.type === 'ai' ? <Sparkles size={16} /> : <Cpu size={16} />}运行工具</>}</button>
        </div>
      </div>

      <div className={`output-card ${output ? 'has-output' : ''}`}>
        <div className="output-header"><span>处理结果</span>{output && <button onClick={copy}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? '已复制' : '复制'}</button>}</div>
        {output ? <pre>{output}</pre> : <div className="empty-output"><div><Boxes size={21} /></div><p>运行工具后，结果会出现在这里</p></div>}
      </div>
    </motion.div>
  )
}

const fileName = (path) => path.split(/[\\/]/).pop()

function renamePreview(path, pattern, number) {
  const original = fileName(path)
  const dot = original.lastIndexOf('.')
  const stem = dot > 0 ? original.slice(0, dot) : original
  const ext = dot > 0 ? original.slice(dot + 1) : ''
  const containsExtension = pattern.includes('{ext}')
  let value = pattern.replaceAll('{name}', stem).replaceAll('{ext}', ext)
  value = value.replace(/\{n(?::(\d+))?\}/g, (_, width) => String(number).padStart(Number(width || 0), '0'))
  if (!containsExtension && ext) value += `.${ext}`
  return value
}

function FileToolPage({ tool, configured, openSettings, goHome }) {
  const [files, setFiles] = useState([])
  const [outputDir, setOutputDir] = useState('')
  const [instruction, setInstruction] = useState('')
  const [target, setTarget] = useState('txt')
  const [pattern, setPattern] = useState('{name}-{n:02}')
  const [start, setStart] = useState(1)
  const [keepOriginals, setKeepOriginals] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const Icon = tool.icon

  const chooseFiles = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中使用文件工具')
    const selected = await window.desktop.selectFiles(tool.fileKind)
    if (selected.length) {
      setFiles((current) => [...new Set([...current, ...selected])])
      setResult(null); setError('')
    }
  }

  const chooseOutput = async () => {
    const selected = await window.desktop?.selectDirectory?.()
    if (selected) setOutputDir(selected)
  }

  const run = async () => {
    if (!files.length) return setError('请先选择至少一个文件')
    if (tool.requiresAI && !configured) return openSettings()
    if (tool.id === 'batch_rename' && !pattern.trim()) return setError('请输入重命名规则')
    setLoading(true); setError(''); setResult(null)
    try {
      let data
      if (tool.id === 'file_summary') data = await api.summarizeFiles({ files, instruction, output_dir: outputDir })
      if (tool.id === 'file_convert') data = await api.convertFiles({ files, target, output_dir: outputDir })
      if (tool.id === 'batch_rename') data = await api.renameFiles({ files, pattern, start: Number(start), keep_originals: keepOriginals, output_dir: outputDir })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const resultText = result ? (tool.id === 'file_summary' ? [
    `已生成 ${result.items?.length || 0} 份摘要，并保存为 Markdown 文件`,
    ...(result.failures || []).map((item) => `未处理：${fileName(item.source)}（${item.error}）`),
  ] : [
    result.result,
    ...(result.items || []).flatMap((item) => item.outputs
      ? item.outputs.map((output) => `${fileName(item.source)}  →  ${fileName(output)}`)
      : item.output ? [`${fileName(item.source)}  →  ${fileName(item.output)}`] : []),
    ...(result.failures || []).map((item) => `未处理：${fileName(item.source)}（${item.error}）`),
  ]).filter(Boolean).join('\n') : ''

  const copySummaries = () => {
    if (!result?.result) return
    if (window.desktop?.copyText) window.desktop.copyText(result.result)
    else navigator.clipboard.writeText(result.result)
  }

  return (
    <motion.div className="page-scroll tool-page file-tool-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
      <div className="tool-heading-row">
        <div className={`tool-icon large ${tool.color}`}><Icon size={26} /></div>
        <div><div className="title-with-badge"><h1>{tool.title}</h1>{tool.requiresAI && <span className="ai-badge">需模型</span>}</div><p>{tool.description}</p></div>
      </div>

      <div className="file-workspace">
        <section className="file-panel">
          <div className="panel-heading"><div><strong>1. 添加文件</strong><span>支持一次选择多个文件</span></div><button className="secondary-button compact" onClick={chooseFiles}><FilePlus2 size={15} />选择文件</button></div>
          <div className={`file-dropzone ${files.length ? 'has-files' : ''}`} onClick={!files.length ? chooseFiles : undefined}>
            {!files.length ? <><FolderOpen size={25} /><strong>选择要处理的文件</strong><span>{tool.id === 'file_summary' ? 'PDF、DOCX、XLSX' : tool.id === 'file_convert' ? 'PDF、DOCX、XLSX、CSV、TXT' : '支持任意文件类型'}</span></> : (
              <div className="file-list">{files.map((path, index) => <div className="file-row" key={path}><span className="file-index">{index + 1}</span><div><strong>{fileName(path)}</strong><small>{path}</small></div><button onClick={() => setFiles(files.filter((item) => item !== path))}><Trash2 size={14} /></button></div>)}</div>
            )}
          </div>
          {!!files.length && <button className="text-button" onClick={chooseFiles}>+ 继续添加</button>}
        </section>

        <section className="file-panel settings-panel">
          <div className="panel-heading"><div><strong>2. 处理设置</strong><span>{tool.id === 'batch_rename' ? '执行前请检查名称预览' : '结果不会覆盖源文件'}</span></div></div>
          {tool.id === 'file_summary' && <>
            {!configured && <button className="config-notice" onClick={openSettings}><KeyRound size={17} /><span><strong>摘要需要连接模型</strong>本机只提取文字，提取结果会发送到你配置的服务</span><ArrowRight size={16} /></button>}
            <label className="control-label"><span>摘要要求（可选）</span><input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：每份列出 5 个要点和待办事项" /></label>
          </>}
          {tool.id === 'file_convert' && <label className="control-label"><span>目标格式</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="txt">TXT 文本</option><option value="csv">CSV 表格</option><option value="xlsx">Excel 工作簿</option><option value="docx">Word 文档</option><option value="pdf">PDF（需 LibreOffice）</option></select><small>PDF/Word/Excel → TXT · Excel → CSV · CSV → Excel · TXT → Word</small></label>}
          {tool.id === 'batch_rename' && <>
            <label className="control-label"><span>命名规则</span><input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="{name}-{n:02}" /><small>变量：{'{name}'} 原名 · {'{n}'} 序号 · {'{n:03}'} 三位序号 · {'{ext}'} 扩展名</small></label>
            <label className="control-label short-control"><span>起始序号</span><input type="number" min="0" value={start} onChange={(event) => setStart(event.target.value)} /></label>
            <label className="check-control"><input type="checkbox" checked={keepOriginals} onChange={(event) => setKeepOriginals(event.target.checked)} /><span><strong>保留源文件</strong><small>创建重命名后的副本；关闭后将原地修改文件名</small></span></label>
            {!!files.length && <div className="rename-preview"><span>名称预览</span>{files.slice(0, 6).map((path, index) => <div key={path}><small>{fileName(path)}</small><ArrowRight size={13} /><strong>{renamePreview(path, pattern, Number(start) + index)}</strong></div>)}{files.length > 6 && <em>另外 {files.length - 6} 个文件…</em>}</div>}
          </>}
          {(tool.id !== 'batch_rename' || keepOriginals) && <div className="output-dir"><div><span>输出位置</span><strong>{outputDir || '自动创建“OmniBox 输出”文件夹'}</strong></div><button className="secondary-button compact" onClick={chooseOutput}>更改</button></div>}
          {error && <div className="error-message">{error}</div>}
          <div className="file-run-row"><span>{files.length ? `已选择 ${files.length} 个文件` : '等待选择文件'}</span><button className="primary-button" disabled={loading} onClick={run}>{loading ? <><LoaderCircle className="spin" size={16} />处理中</> : <><Play size={15} />开始处理</>}</button></div>
        </section>
      </div>

      <section className={`output-card file-output ${result ? 'has-output' : ''}`}>
        <div className="output-header"><span>处理结果</span><div className="output-actions">{tool.id === 'file_summary' && result && <button onClick={copySummaries}><Copy size={14} />复制全部摘要</button>}{result?.output_dir && <button onClick={() => window.desktop?.showItemInFolder?.(result.items?.[0]?.output || result.items?.[0]?.outputs?.[0] || result.output_dir)}><FolderOpen size={14} />在文件夹中显示</button>}</div></div>
        {result ? <><pre>{resultText}</pre>{tool.id === 'file_summary' && <div className="summary-results">{result.items?.map((item) => <article key={item.source}><h3>{fileName(item.source)}</h3><p>{item.summary}</p></article>)}</div>}</> : <div className="empty-output"><div><Boxes size={21} /></div><p>完成后可在这里查看结果和输出位置</p></div>}
      </section>
    </motion.div>
  )
}

function SearchPalette({ onClose, selectTool }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  useEffect(() => inputRef.current?.focus(), [])
  const results = useMemo(() => tools.filter((tool) => `${tool.title}${tool.subtitle}${tool.description}`.toLowerCase().includes(query.toLowerCase())), [query])
  return (
    <motion.div className="modal-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="search-palette" initial={{ scale: .97, y: -12 }} animate={{ scale: 1, y: 0 }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input"><Search size={19} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 JSON、正则、图片、端口…" /><kbd>ESC</kbd></div>
        <div className="palette-results">
          <span className="result-label">{query ? `找到 ${results.length} 个工具` : '全部工具'}</span>
          {results.map((tool) => { const Icon = tool.icon; return <button key={tool.id} onClick={() => selectTool(tool)}><div className={`tool-icon small ${tool.color}`}><Icon size={17} /></div><span><strong>{tool.title}</strong><small>{tool.subtitle}</small></span>{tool.type === 'hybrid' ? <em>双模式</em> : (tool.type === 'ai' || tool.requiresAI) && <em>需模型</em>}<ArrowRight size={15} /></button> })}
          {!results.length && <div className="no-results">没有找到匹配的工具</div>}
        </div>
      </motion.div>
    </motion.div>
  )
}

function SettingsModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ provider: 'openai', base_url: providerPresets.openai.base_url, model: providerPresets.openai.model, api_key: '', youdao_app_key: '', youdao_app_secret: '', baidu_app_id: '', baidu_app_key: '' })
  const [hasKey, setHasKey] = useState(false)
  const [hasYoudao, setHasYoudao] = useState(false)
  const [hasBaidu, setHasBaidu] = useState(false)
  const [visibleSecrets, setVisibleSecrets] = useState({ api: false, youdaoKey: false, youdaoSecret: false, baiduId: false, baiduKey: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.settings().then((data) => {
      setForm((current) => ({
        ...current,
        provider: data.provider,
        base_url: data.base_url,
        model: data.model,
        api_key: data.api_key || '',
        youdao_app_key: data.youdao_app_key || '',
        youdao_app_secret: data.youdao_app_secret || '',
        baidu_app_id: data.baidu_app_id || '',
        baidu_app_key: data.baidu_app_key || '',
      }))
      setHasKey(data.has_api_key)
      setHasYoudao(data.has_youdao_credentials)
      setHasBaidu(data.has_baidu_credentials)
    }).catch((error) => setMessage(error.message)).finally(() => setLoading(false))
  }, [])

  const changeProvider = (provider) => {
    const preset = providerPresets[provider]
    setForm((current) => ({ ...current, provider, base_url: preset.base_url, model: preset.model }))
  }
  const toggleSecret = (field) => setVisibleSecrets((current) => ({ ...current, [field]: !current[field] }))
  const save = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const data = await api.saveSettings(form)
      setHasKey(data.has_api_key); setHasYoudao(data.has_youdao_credentials); setHasBaidu(data.has_baidu_credentials)
      onSaved({ hasKey: data.has_api_key, hasYoudao: data.has_youdao_credentials, hasBaidu: data.has_baidu_credentials }); setMessage('设置已保存到本机')
    } catch (error) { setMessage(error.message) }
    finally { setSaving(false) }
  }

  return (
    <motion.div className="modal-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="settings-modal" initial={{ scale: .97, y: 12 }} animate={{ scale: 1, y: 0 }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title"><div><h2>服务与设置</h2><p>配置 AI 模型、有道或百度文本翻译服务</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
        {loading ? <div className="settings-loading"><LoaderCircle className="spin" /></div> : (
          <form onSubmit={save}>
            <div className="settings-section"><span className="form-label">AI 模型服务</span><div className="provider-grid">{Object.entries(providerPresets).map(([id, item]) => <button type="button" key={id} className={form.provider === id ? 'active' : ''} onClick={() => changeProvider(id)}>{form.provider === id && <Check size={14} />}{item.label}</button>)}</div></div>
            <label className="field-label"><span>API 地址</span><input value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="https://api.example.com/v1" /></label>
            <label className="field-label"><span>模型名称</span><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="model-name" /></label>
            <label className="field-label"><span>API Key {hasKey && <em><Check size={12} />已保存</em>}</span><div className="secret-input"><input type={visibleSecrets.api ? 'text' : 'password'} value={form.api_key} onChange={(event) => setForm({ ...form, api_key: event.target.value })} placeholder="sk-..." /><button type="button" onClick={() => toggleSecret('api')} aria-label={visibleSecrets.api ? '隐藏 API Key' : '显示 API Key'} title={visibleSecrets.api ? '隐藏 API Key' : '显示 API Key'}>{visibleSecrets.api ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            <div className="settings-divider"><span>有道文本翻译</span><a href="https://ai.youdao.com/appmgr.s" target="_blank" rel="noreferrer">打开有道应用管理</a></div>
            <label className="field-label"><span>有道 App Key {hasYoudao && <em><Check size={12} />已保存</em>}</span><div className="secret-input"><input type={visibleSecrets.youdaoKey ? 'text' : 'password'} value={form.youdao_app_key} onChange={(event) => setForm({ ...form, youdao_app_key: event.target.value })} placeholder="应用 ID" /><button type="button" onClick={() => toggleSecret('youdaoKey')} aria-label={visibleSecrets.youdaoKey ? '隐藏有道 App Key' : '显示有道 App Key'} title={visibleSecrets.youdaoKey ? '隐藏有道 App Key' : '显示有道 App Key'}>{visibleSecrets.youdaoKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            <label className="field-label"><span>有道 App Secret</span><div className="secret-input"><input type={visibleSecrets.youdaoSecret ? 'text' : 'password'} value={form.youdao_app_secret} onChange={(event) => setForm({ ...form, youdao_app_secret: event.target.value })} placeholder="应用密钥" /><button type="button" onClick={() => toggleSecret('youdaoSecret')} aria-label={visibleSecrets.youdaoSecret ? '隐藏有道 App Secret' : '显示有道 App Secret'} title={visibleSecrets.youdaoSecret ? '隐藏有道 App Secret' : '显示有道 App Secret'}>{visibleSecrets.youdaoSecret ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            <div className="settings-divider"><span>百度文本翻译</span><a href="https://api.fanyi.baidu.com/manage/developer" target="_blank" rel="noreferrer">打开百度翻译控制台</a></div>
            <label className="field-label"><span>百度 APP ID {hasBaidu && <em><Check size={12} />已保存</em>}</span><div className="secret-input"><input type={visibleSecrets.baiduId ? 'text' : 'password'} value={form.baidu_app_id} onChange={(event) => setForm({ ...form, baidu_app_id: event.target.value })} placeholder="APP ID" /><button type="button" onClick={() => toggleSecret('baiduId')} aria-label={visibleSecrets.baiduId ? '隐藏百度 APP ID' : '显示百度 APP ID'} title={visibleSecrets.baiduId ? '隐藏百度 APP ID' : '显示百度 APP ID'}>{visibleSecrets.baiduId ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            <label className="field-label"><span>百度密钥</span><div className="secret-input"><input type={visibleSecrets.baiduKey ? 'text' : 'password'} value={form.baidu_app_key} onChange={(event) => setForm({ ...form, baidu_app_key: event.target.value })} placeholder="密钥" /><button type="button" onClick={() => toggleSecret('baiduKey')} aria-label={visibleSecrets.baiduKey ? '隐藏百度密钥' : '显示百度密钥'} title={visibleSecrets.baiduKey ? '隐藏百度密钥' : '显示百度密钥'}>{visibleSecrets.baiduKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
            <div className="security-note"><LockKeyhole size={16} /><span>凭据以明文保存在当前用户的本地配置文件中（macOS：~/.omnibox/settings.json；Windows：%APPDATA%/settings.json），不再访问系统钥匙串。类 Unix 系统文件权限设为 600。</span></div>
            {message && <div className={message.includes('已保存') ? 'success-message' : 'error-message'}>{message}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving && <LoaderCircle className="spin" size={16} />}{saving ? '保存中' : '保存设置'}</button></div>
          </form>
        )}
      </motion.div>
    </motion.div>
  )
}

export default App
