import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Check, Clipboard, FileImage, FileSpreadsheet, FileText, FolderOpen, KeyRound,
  LoaderCircle, Play, Sparkles, Trash2, Volume2,
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import 'highlight.js/styles/github-dark-dimmed.css'
import { api } from './api'


Object.entries({ bash, css, javascript, json, markdown, python, typescript, xml }).forEach(([name, grammar]) => hljs.registerLanguage(name, grammar))

const fileName = (path) => path.split(/[\\/]/).pop()

function Header({ tool, goHome }) {
  const Icon = tool.icon
  return <>
    <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
    <div className="tool-heading-row">
      <div className={`tool-icon large ${tool.color}`}><Icon size={26} /></div>
      <div><div className="title-with-badge"><h1>{tool.title}</h1><span className="dual-badge">双模式</span></div><p>{tool.description}</p></div>
    </div>
  </>
}

function ModeTabs({ mode, setMode, configured, openSettings, localLabel = '无需 AI Key' }) {
  return <div className="mode-row">
    <div className="action-tabs mode-tabs">
      <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>普通模式</button>
      <button className={mode === 'ai' ? 'active' : ''} onClick={() => configured ? setMode('ai') : openSettings()}><Sparkles size={13} />AI 增强</button>
    </div>
    <span>{mode === 'local' ? localLabel : '使用你配置的模型服务'}</span>
  </div>
}

function Result({ output, loading, copy, notice = '', meta = '', actions = null }) {
  const [copied, setCopied] = useState(false)
  const doCopy = async () => {
    await copy(output)
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }
  return <section className={`output-card hybrid-output ${output ? 'has-output' : ''}`}>
    <div className="output-header"><span>处理结果</span>{output && <div className="output-actions">{actions}<button onClick={doCopy}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? '已复制' : '复制'}</button></div>}</div>
    {notice && <div className="tool-notice warning">{notice}</div>}
    {meta && <div className="result-meta">{meta}</div>}
    {loading ? <div className="empty-output"><LoaderCircle className="spin" size={22} /><p>正在处理</p></div>
      : output ? <pre>{output}</pre> : <div className="empty-output"><FileText size={22} /><p>结果会显示在这里</p></div>}
  </section>
}

const copyText = async (text) => {
  if (window.desktop?.copyText) window.desktop.copyText(text)
  else await navigator.clipboard.writeText(text)
}

function TranslateTool({ tool, configured, translationServices = {}, openSettings, goHome }) {
  const [mode, setMode] = useState('local')
  const [engine, setEngine] = useState('youdao')
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [source, setSource] = useState('auto')
  const [target, setTarget] = useState('zh-CN')
  const [style, setStyle] = useState('自然、准确，保留原格式')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [speaking, setSpeaking] = useState('')
  const translationConfigured = Boolean(translationServices[engine])
  useEffect(() => () => window.speechSynthesis?.cancel(), [])
  useEffect(() => {
    if (!translationServices[engine] && translationServices.baidu) setEngine('baidu')
  }, [translationServices, engine])
  const run = async () => {
    if (!text.trim()) return setError('请输入需要翻译的文字')
    if (source !== 'auto' && source === target) return setError('源语言与目标语言不能相同')
    const detected = detectScriptLanguage(text)
    if (detected && detected === target) return setError(`检测到输入内容是${languageLabel(detected)}，与目标语言相同`)
    const ambiguousHan = detected === 'zh-CN' && source === 'ja'
    if (source !== 'auto' && detected && source !== detected && !ambiguousHan) return setError(`源语言选择了${languageLabel(source)}，但输入内容检测为${languageLabel(detected)}；请改为自动识别或修正源语言`)
    if (mode === 'local' && !translationConfigured) return openSettings()
    setLoading(true); setError(''); setResult(null)
    try {
      if (mode === 'local') {
        setResult(await api.hybridTranslate({ text, source, target, engine }))
      } else {
        const targetLabel = languages.find(([value]) => value === target)?.[1] || target
        const data = await api.runAI({ tool: 'translate', input: text, instruction: `翻译为${targetLabel}；风格：${style}` })
        setResult({ ...data, engine: 'AI 增强翻译' })
      }
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const speak = (accent) => {
    if (!result?.result || !window.speechSynthesis) return setError('当前系统没有可用的语音朗读服务')
    window.speechSynthesis.cancel()
    if (speaking === accent) return setSpeaking('')
    const utterance = new SpeechSynthesisUtterance(result.result)
    utterance.lang = accent
    utterance.rate = .92
    const voices = window.speechSynthesis.getVoices()
    const preferredNames = accent === 'en-US'
      ? ['Samantha', 'Microsoft Aria', 'Microsoft David', 'Google US English', 'Aaron']
      : ['Daniel', 'Microsoft Ryan', 'Microsoft Sonia', 'Google UK English', 'Arthur']
    const accentVoices = voices.filter((voice) => voice.lang.toLowerCase() === accent.toLowerCase())
    utterance.voice = preferredNames.map((name) => accentVoices.find((voice) => voice.name.includes(name))).find(Boolean)
      || accentVoices[0]
      || voices.find((voice) => voice.lang.toLowerCase().startsWith(accent.slice(0, 2).toLowerCase()))
      || null
    utterance.onend = () => setSpeaking('')
    utterance.onerror = () => { setSpeaking(''); setError('语音播放失败，请检查系统语音设置') }
    setSpeaking(accent)
    window.speechSynthesis.speak(utterance)
  }
  const pronunciation = result?.result && target === 'en' ? <div className="speech-actions"><button className={speaking === 'en-US' ? 'active' : ''} onClick={() => speak('en-US')}><Volume2 size={14} />美式</button><button className={speaking === 'en-GB' ? 'active' : ''} onClick={() => speak('en-GB')}><Volume2 size={14} />英式</button></div> : null
  return <Page tool={tool} goHome={goHome}>
    <ModeTabs mode={mode} setMode={setMode} configured={configured} openSettings={openSettings} localLabel={translationConfigured ? `${engine === 'youdao' ? '有道' : '百度'}翻译已配置` : `需要配置${engine === 'youdao' ? '有道' : '百度'}凭据`} />
    <div className="hybrid-grid">
      <section className="workspace-card hybrid-input-panel">
        {mode === 'local' && <label className="control-label translation-engine"><span>普通翻译引擎</span><select value={engine} onChange={(event) => { setEngine(event.target.value); setResult(null); setError('') }}><option value="youdao">有道智云</option><option value="baidu">百度翻译开放平台</option></select><small>{translationServices[engine] ? '当前引擎凭据已配置' : '当前引擎尚未配置凭据'}</small></label>}
        {mode === 'local' && !translationConfigured && <button className="config-notice service-notice" onClick={openSettings}><KeyRound size={17} /><span><strong>需要{engine === 'youdao' ? '有道' : '百度'}翻译凭据</strong>在“服务与设置”中填写{engine === 'youdao' ? ' App Key 和 App Secret' : ' APP ID 和密钥'}</span><ArrowRight size={16} /></button>}
        <div className="inline-controls translation-controls">
          <label className="control-label"><span>源语言</span><select value={source} onChange={(e) => setSource(e.target.value)}>{languages.map(([value, label]) => <option key={value} value={value}>{value === 'auto' ? '自动识别' : label}</option>)}</select></label>
          <label className="control-label"><span>目标语言</span><select value={target} onChange={(e) => setTarget(e.target.value)}>{languages.filter(([value]) => value !== 'auto').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="editor-block"><div className="editor-label"><span>原文</span><span>{text.length} 字符</span></div><textarea className="tall-editor" value={text} onChange={(e) => setText(e.target.value)} placeholder="输入需要翻译的内容…" /></div>
        {mode === 'ai' && <label className="control-label ai-option"><span>表达风格</span><input value={style} onChange={(e) => setStyle(e.target.value)} /></label>}
        <RunRow mode={mode} run={run} loading={loading} error={error} localText={`文本通过${engine === 'youdao' ? '有道智云' : '百度翻译开放平台'}处理，不使用 AI 模型 Key`} />
      </section>
      <Result output={result?.result || ''} loading={loading} copy={copyText} notice={result?.warning} meta={result ? `${result.engine}${result.detected_source_label ? ` · 检测为${result.detected_source_label}` : ''}` : ''} actions={pronunciation} />
    </div>
  </Page>
}

const languages = [['auto', '自动识别'], ['zh-CN', '简体中文'], ['en', '英文'], ['ja', '日文'], ['ko', '韩文'], ['fr', '法文'], ['de', '德文'], ['es', '西班牙文'], ['ru', '俄文']]
const languageLabel = (value) => languages.find(([id]) => id === value)?.[1] || value
const detectScriptLanguage = (value) => {
  if (/[\u3040-\u30ff]/.test(value)) return 'ja'
  if (/[\uac00-\ud7af]/.test(value)) return 'ko'
  if (/[\u4e00-\u9fff]/.test(value)) return 'zh-CN'
  if (/[\u0400-\u04ff]/.test(value)) return 'ru'
  return ''
}

function CodeTool({ tool, configured, openSettings, goHome }) {
  const [mode, setMode] = useState('local')
  const [action, setAction] = useState('format')
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [naming, setNaming] = useState('camel')
  const [context, setContext] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    if (!(mode === 'ai' ? context : text).trim()) return setError(mode === 'ai' ? '请描述业务语义' : '请输入代码或名称')
    setLoading(true); setError(''); setOutput('')
    try {
      const data = mode === 'local'
        ? await api.hybridCode({ action, text, language, naming })
        : await api.runAI({ tool: 'code_naming', input: context, instruction: `目标语言：${language}；命名风格：${naming}；生成变量名和函数名候选` })
      setOutput(data.result)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <Page tool={tool} goHome={goHome}>
    <ModeTabs mode={mode} setMode={setMode} configured={configured} openSettings={openSettings} />
    <div className="hybrid-grid">
      <section className="workspace-card hybrid-input-panel">
        {mode === 'local' && <div className="action-tabs"><button className={action === 'format' ? 'active' : ''} onClick={() => setAction('format')}>代码格式化</button><button className={action === 'rename' ? 'active' : ''} onClick={() => setAction('rename')}>命名格式转换</button></div>}
        <div className="inline-controls">
          <label className="control-label grow"><span>语言</span><select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="json">JSON</option><option value="html">HTML</option><option value="css">CSS</option></select></label>
          {(action === 'rename' || mode === 'ai') && <label className="control-label grow"><span>命名风格</span><select value={naming} onChange={(e) => setNaming(e.target.value)}><option value="camel">camelCase</option><option value="pascal">PascalCase</option><option value="snake">snake_case</option><option value="kebab">kebab-case</option><option value="constant">CONSTANT_CASE</option></select></label>}
        </div>
        <div className="editor-block"><div className="editor-label"><span>{mode === 'ai' ? '业务语义' : action === 'format' ? '代码' : '原名称'}</span></div><textarea className="code-editor tall-editor" value={mode === 'ai' ? context : text} onChange={(e) => mode === 'ai' ? setContext(e.target.value) : setText(e.target.value)} placeholder={mode === 'ai' ? '例如：根据订单状态判断是否允许退款，并记录拒绝原因' : action === 'format' ? '粘贴需要格式化的代码…' : '例如：user profile url'} /></div>
        <RunRow mode={mode} run={run} loading={loading} error={error} />
      </section>
      <Result output={output} loading={loading} copy={copyText} />
    </div>
  </Page>
}

function OCRTool({ tool, configured, openSettings, goHome }) {
  const [mode, setMode] = useState('local')
  const [files, setFiles] = useState([])
  const [format, setFormat] = useState('text')
  const [instruction, setInstruction] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const choose = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中使用 OCR')
    const selected = await window.desktop.selectFiles('ocr')
    setFiles((current) => [...new Set([...current, ...selected])]); setError('')
  }
  const run = async () => {
    if (!files.length) return setError('请先选择图片')
    setLoading(true); setError(''); setOutput('')
    try {
      if (mode === 'local') {
        const data = await api.hybridOCR({ files })
        const sections = data.items.map((item) => `## ${fileName(item.source)}\n${item.text || '[未识别到文字]'}`)
        const failures = data.failures.map((item) => `未处理：${fileName(item.source)}（${item.error}）`)
        setOutput([...sections, ...failures].join('\n\n'))
      } else {
        const data = await api.hybridOCRAI({ files, output_format: format, instruction })
        setOutput(data.result)
      }
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <Page tool={tool} goHome={goHome}>
    <ModeTabs mode={mode} setMode={setMode} configured={configured} openSettings={openSettings} />
    <div className="hybrid-grid">
      <section className="workspace-card hybrid-input-panel">
        <div className="panel-heading"><div><strong>选择图片</strong><span>{mode === 'local' ? '本地 ONNX 引擎，不上传图片' : '图片会发送至你配置的多模态模型'}</span></div><button className="secondary-button compact" onClick={choose}><FileImage size={15} />添加图片</button></div>
        <div className={`ocr-file-list ${files.length ? '' : 'empty'}`} onClick={!files.length ? choose : undefined}>
          {!files.length ? <><FileImage size={25} /><strong>PNG、JPG、WebP、BMP、TIFF</strong><span>可一次选择多张图片</span></> : files.map((path) => <div key={path}><FileImage size={16} /><span><strong>{fileName(path)}</strong><small>{path}</small></span><button onClick={() => setFiles(files.filter((item) => item !== path))}><Trash2 size={14} /></button></div>)}
        </div>
        {mode === 'ai' && <><label className="control-label ai-option"><span>输出格式</span><select value={format} onChange={(e) => setFormat(e.target.value)}><option value="text">纯文本</option><option value="markdown_table">Markdown 表格</option><option value="json">结构化 JSON</option></select></label><label className="control-label"><span>额外要求（可选）</span><input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例如：保留发票字段名称并纠正常见错字" /></label></>}
        <RunRow mode={mode} run={run} loading={loading} error={error} />
      </section>
      <Result output={output} loading={loading} copy={copyText} />
    </div>
  </Page>
}

function MarkdownTool({ tool, configured, openSettings, goHome }) {
  const [text, setText] = useState('# 新文档\n\n开始写作。')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const previewRef = useRef(null)
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true })), [text])
  useEffect(() => { previewRef.current?.querySelectorAll('pre code').forEach((block) => { delete block.dataset.highlighted; hljs.highlightElement(block) }) }, [html])
  const aiAction = async (action) => {
    if (!configured) return openSettings()
    setLoading(true); setError('')
    try {
      const toolName = { continue: 'markdown_continue', toc: 'markdown_toc', summary: 'markdown_summary' }[action]
      const data = await api.runAI({ tool: toolName, input: text, instruction: '' })
      if (action === 'continue') setText((current) => `${current.trimEnd()}\n\n${data.result}`)
      else if (action === 'toc') setText((current) => `${data.result}\n\n${current}`)
      else setText((current) => `> ${data.result.replaceAll('\n', '\n> ')}\n\n${current}`)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const exportPdf = async () => {
    if (!window.desktop?.exportMarkdownPdf) return setError('请在 OmniBox 桌面应用中导出 PDF')
    const title = text.match(/^#\s+(.+)$/m)?.[1] || 'Markdown 文档'
    const result = await window.desktop.exportMarkdownPdf({ title, html })
    if (result?.error) setError(result.error)
  }
  return <Page tool={tool} goHome={goHome}>
    <div className="markdown-toolbar">
      <div><button className="secondary-button compact" onClick={exportPdf}><FileText size={14} />导出 PDF</button><span>本地实时预览 · 支持语法高亮</span></div>
      <div><button disabled={loading} onClick={() => aiAction('continue')}><Sparkles size={13} />续写</button><button disabled={loading} onClick={() => aiAction('toc')}>生成目录</button><button disabled={loading} onClick={() => aiAction('summary')}>生成摘要</button></div>
    </div>
    {error && <div className="error-message markdown-error">{error}</div>}
    <div className="markdown-workspace">
      <section><div className="editor-label"><span>Markdown</span><span>{text.length} 字符</span></div><textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck="false" /></section>
      <section><div className="editor-label"><span>预览</span><span>{loading ? 'AI 正在处理…' : '即时更新'}</span></div><article ref={previewRef} className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /></section>
    </div>
  </Page>
}

function OfficeTool({ tool, configured, openSettings, goHome }) {
  const [action, setAction] = useState('formula')
  const [file, setFile] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [instruction, setInstruction] = useState('帮我在 A 列找和 B 列相同的名字，把 C 列对应的数值相加')
  const [options, setOptions] = useState({
    trim_text: true, remove_blank_rows: true, deduplicate_rows: false,
    trim_whitespace: true, remove_empty_paragraphs: true, remove_manual_page_breaks: true, remove_empty_table_rows: false,
  })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isAI = action === 'formula' || action === 'ai_process'
  const choose = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中选择 Office 文件')
    const kind = action === 'excel_clean' ? 'excel' : action === 'word_clean' ? 'word' : 'office'
    const selected = await window.desktop.selectFiles(kind)
    if (selected.length) { setFile(selected[0]); setError('') }
  }
  const chooseOutput = async () => {
    const selected = await window.desktop?.selectDirectory?.()
    if (selected) setOutputDir(selected)
  }
  const switchAction = (value) => {
    setAction(value); setResult(null); setError('')
    if (value === 'formula') setInstruction('帮我在 A 列找和 B 列相同的名字，把 C 列对应的数值相加')
    if (value === 'ai_process') setInstruction('删除空白行，清理文本首尾空格，并在 D 列填入汇总公式')
  }
  const toggleOption = (key) => setOptions((current) => ({ ...current, [key]: !current[key] }))
  const run = async () => {
    if (isAI && !configured) return openSettings()
    if (action === 'formula' && !instruction.trim()) return setError('请描述需要生成的 Excel 公式')
    if (action !== 'formula' && !file) return setError('请先选择要处理的 Office 文件')
    if (action === 'ai_process' && !instruction.trim()) return setError('请描述希望如何处理文件')
    setLoading(true); setError(''); setResult(null)
    try {
      const data = action === 'formula'
        ? await api.officeFormula({ instruction, file })
        : await api.officeProcess({ action, file, instruction, output_dir: outputDir, options })
      setResult(data)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const resultText = result ? [result.result, ...(result.operations || []).map((item) => `- ${item}`)].join('\n') : ''
  const resultActions = result?.output ? <button onClick={() => window.desktop?.showItemInFolder?.(result.output)}><FolderOpen size={14} />打开文件位置</button> : null
  return <Page tool={tool} goHome={goHome}>
    <div className="action-tabs office-tabs"><button className={action === 'formula' ? 'active' : ''} onClick={() => switchAction('formula')}>白话生成公式</button><button className={action === 'excel_clean' ? 'active' : ''} onClick={() => switchAction('excel_clean')}>Excel 本地清理</button><button className={action === 'word_clean' ? 'active' : ''} onClick={() => switchAction('word_clean')}>Word 本地清理</button><button className={action === 'ai_process' ? 'active' : ''} onClick={() => switchAction('ai_process')}><Sparkles size={13} />按描述处理文件</button></div>
    <div className="hybrid-grid office-grid">
      <section className="workspace-card hybrid-input-panel office-input-panel">
        {isAI && !configured && <button className="config-notice service-notice" onClick={openSettings}><KeyRound size={17} /><span><strong>需要连接模型</strong>公式生成和自然语言处理需要 AI API Key</span><ArrowRight size={16} /></button>}
        <div className="panel-heading"><div><strong>{action === 'formula' ? '工作簿（可选）' : '选择源文件'}</strong><span>{action === 'formula' ? '附加工作簿后会读取表名、少量样例和公式用于生成准确引用' : '始终另存副本，不覆盖源文件'}</span></div><button className="secondary-button compact" onClick={choose}>{action === 'word_clean' ? <FileText size={15} /> : <FileSpreadsheet size={15} />}{file ? '重新选择' : '选择文件'}</button></div>
        <div className={`office-file ${file ? 'selected' : ''}`} onClick={!file ? choose : undefined}>{file ? <><div><strong>{fileName(file)}</strong><small>{file}</small></div><button onClick={() => setFile('')}><Trash2 size={14} /></button></> : <><FileSpreadsheet size={24} /><span>{action === 'word_clean' ? 'DOCX' : action === 'excel_clean' || action === 'formula' ? 'XLSX / XLSM' : 'XLSX / XLSM / DOCX'}</span></>}</div>
        {(action === 'formula' || action === 'ai_process') && <label className="editor-block office-instruction"><div className="editor-label"><span>{action === 'formula' ? '白话需求' : '处理要求'}</span><span>{instruction.length} 字符</span></div><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={action === 'formula' ? '描述要查找、汇总或匹配的数据…' : '例如：清理空白行并在结果列添加公式…'} /></label>}
        {action === 'excel_clean' && <div className="office-options">{[['trim_text', '清理文本首尾空格'], ['remove_blank_rows', '删除完全空白的行'], ['deduplicate_rows', '按整行内容去重（保留首行标题）']].map(([key, label]) => <label className="check-control" key={key}><input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} /><span><strong>{label}</strong></span></label>)}</div>}
        {action === 'word_clean' && <div className="office-options">{[['trim_whitespace', '清理段落首尾空白'], ['remove_empty_paragraphs', '删除无内容的空段落'], ['remove_manual_page_breaks', '删除人工分页符（常见空白页来源）'], ['remove_empty_table_rows', '删除完全空白的表格行']].map(([key, label]) => <label className="check-control" key={key}><input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} /><span><strong>{label}</strong></span></label>)}</div>}
        {action !== 'formula' && <div className="output-dir"><div><span>输出位置</span><strong>{outputDir || '自动创建“OmniBox 输出”文件夹'}</strong></div><button className="secondary-button compact" onClick={chooseOutput}>更改</button></div>}
        <div className={`tool-notice ${isAI ? 'warning' : ''}`}>{isAI ? <Sparkles size={15} /> : <Check size={15} />}<span>{isAI ? '只会向模型发送你的描述与有限的文档结构/样例；模型返回白名单计划后由本机执行，不运行任意脚本。' : '完全在本机处理并保留源文件。复杂分页可能与字体、打印机和页面设置有关，建议打开输出文档复核。'}</span></div>
        <RunRow mode={isAI ? 'ai' : 'local'} run={run} loading={loading} error={error} localText="文件只在本机处理，结果另存为副本" />
      </section>
      <Result output={resultText} loading={loading} copy={copyText} meta={result?.output ? `输出：${result.output}` : action === 'formula' ? '公式与使用说明' : ''} actions={resultActions} />
    </div>
  </Page>
}

function RunRow({ mode, run, loading, error, localText = '普通模式不使用模型 Key' }) {
  return <>{error && <div className="error-message">{error}</div>}<div className="run-row"><span>{mode === 'local' ? localText : '内容将发送至配置的模型服务'}</span><button className="primary-button" onClick={run} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} />处理中</> : <><Play size={15} />开始处理</>}</button></div></>
}

function Page({ tool, goHome, children }) {
  return <motion.div className="page-scroll tool-page hybrid-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Header tool={tool} goHome={goHome} />{children}</motion.div>
}

export default function HybridToolPage(props) {
  if (props.tool.id === 'translate') return <TranslateTool {...props} />
  if (props.tool.id === 'code_studio') return <CodeTool {...props} />
  if (props.tool.id === 'ocr') return <OCRTool {...props} />
  if (props.tool.id === 'office_assistant') return <OfficeTool {...props} />
  return <MarkdownTool {...props} />
}
