import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Cloud, Download, FileText, FolderOpen, LayoutTemplate,
  LoaderCircle, MonitorPlay, Plus, Presentation, RefreshCw, ShieldAlert, Sparkles, Trash2,
} from 'lucide-react'
import { api } from './api'
import { localQualityCheck, PRESENTATION_THEMES } from './presentationP1'
import './presentation.css'


const emptyDeck = () => ({ title: '未命名演示', slides: [], warnings: [] })
const fileName = (value = '') => value.split(/[\\/]/).pop()
const themeById = (id) => PRESENTATION_THEMES.find((item) => item.id === id) || PRESENTATION_THEMES[0]

function ChartPreview({ chart }) {
  const maximum = Math.max(1, ...chart.series.flatMap((item) => item.values.map((value) => Math.abs(Number(value) || 0))))
  return <div className="presentation-chart"><div>{chart.series.map((series) => <span key={series.name}>{series.name}</span>)}</div>{chart.categories.slice(0, 7).map((category, index) => <label key={`${category}-${index}`}><em>{category}</em><span>{chart.series.map((series) => <i key={series.name} style={{ width: `${Math.max(3, Math.abs(Number(series.values[index]) || 0) / maximum * 100)}%` }} />)}</span></label>)}</div>
}

function TablePreview({ table }) {
  return <div className="presentation-table"><table><thead><tr>{table.headers.slice(0, 5).map((item, index) => <th key={`${item}-${index}`}>{item}</th>)}</tr></thead><tbody>{table.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.slice(0, 5).map((item, cell) => <td key={cell}>{item}</td>)}</tr>)}</tbody></table></div>
}

function SlideCanvas({ slide, deckTitle, themeId, compact = false }) {
  const theme = themeById(themeId)
  const variables = {
    '--deck-bg': `#${theme.bg}`, '--deck-panel': `#${theme.panel}`, '--deck-ink': `#${theme.ink}`,
    '--deck-muted': `#${theme.muted}`, '--deck-accent': `#${theme.accent}`, '--deck-accent2': `#${theme.accent2}`,
  }
  return <div className={`presentation-canvas layout-${theme.layout} font-${theme.font} ${compact ? 'compact' : ''}`} style={variables}>
    <span className="presentation-eyebrow">OMNIBOX PRESENTATION</span>
    <div className="presentation-canvas-grid">
      <div><h2>{slide?.title || deckTitle || '演示标题'}</h2>{slide?.body?.length > 0 && <ul>{slide.body.slice(0, compact ? 3 : 6).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}</div>
      {slide?.chart ? <ChartPreview chart={slide.chart} /> : slide?.images?.[0]?.data_url ? <img src={slide.images[0].data_url} alt="演示素材" /> : slide?.table ? <TablePreview table={slide.table} /> : <i aria-hidden="true" />}
    </div>
    <footer><span>{deckTitle || 'OmniBox 演示'}</span><span>OmniBox</span></footer>
  </div>
}

export default function PresentationStudio({ tool, goHome }) {
  const [mode, setMode] = useState('file')
  const [source, setSource] = useState('')
  const [markdown, setMarkdown] = useState('# 项目周报\n\n## 本周进展\n- 完成核心功能开发\n- 关键指标符合预期\n\n## 下周计划\n- 完成验收与发布\n- 收集用户反馈')
  const [deck, setDeck] = useState(emptyDeck)
  const [themeId, setThemeId] = useState('executive')
  const [activeIndex, setActiveIndex] = useState(0)
  const [quality, setQuality] = useState(null)
  const [templates, setTemplates] = useState([])
  const [templateWarning, setTemplateWarning] = useState('')
  const [templateLoading, setTemplateLoading] = useState(true)
  const [templateBusy, setTemplateBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const activeSlide = deck.slides[activeIndex]
  const localIssues = useMemo(() => localQualityCheck(deck), [deck])
  const allIssues = useMemo(() => {
    const sourceIssues = quality?.issues || []
    const keys = new Set(sourceIssues.map((item) => `${item.page}-${item.code}`))
    return [...sourceIssues, ...localIssues.filter((item) => !keys.has(`${item.page}-${item.code}`))]
  }, [quality, localIssues])

  const loadTemplates = async (refresh = false) => {
    setTemplateLoading(true)
    try {
      const result = await api.presentationTemplates(refresh)
      setTemplates(result.templates || []); setTemplateWarning(result.warning || '')
    } catch (err) { setTemplateWarning(err.message) } finally { setTemplateLoading(false) }
  }
  useEffect(() => { loadTemplates() }, [])

  const choose = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中选择文件')
    const selected = await window.desktop.selectFiles('presentation')
    if (selected[0]) { setSource(selected[0]); setError(''); setMessage('') }
  }

  const inspect = async (nextDeck = deck) => {
    if (!nextDeck.slides?.length) return
    try { setQuality(await api.inspectPresentation({ deck: nextDeck })) } catch (err) { setError(err.message) }
  }

  const extract = async () => {
    if (mode === 'file' && !source) return setError('请先选择 Markdown、Word、Excel 或 PPTX 文件')
    if (mode === 'markdown' && !markdown.trim()) return setError('请输入 Markdown 内容')
    setLoading(true); setError(''); setMessage(''); setQuality(null)
    try {
      const result = await api.extractPresentation(mode === 'file' ? { source, max_slides: 40 } : { markdown, max_slides: 40 })
      setDeck(result); setActiveIndex(0); await inspect(result)
      setMessage(`已生成 ${result.slides.length} 页大纲${result.source_type?.startsWith('xls') ? ' · 已识别 Excel 数据并生成图表' : ''}${result.warnings?.length ? ` · ${result.warnings.join('；')}` : ''}`)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const useTemplate = async (item) => {
    setTemplateBusy(item.id); setError('')
    try {
      const fromCache = item.cached && !item.update_available
      const result = fromCache ? await api.cachedPresentationTemplate(item.id) : await api.downloadPresentationTemplate(item.id)
      const template = result.template
      setDeck(template.deck); setThemeId(template.style); setActiveIndex(0); setQuality(null)
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, cached: true, cached_version: template.version, update_available: false } : entry))
      setMessage(`${fromCache ? '已从本地缓存载入' : item.update_available ? '已更新并载入' : '已按需下载并载入'}“${item.name}”，可直接修改占位内容`)
    } catch (err) { setError(err.message) } finally { setTemplateBusy('') }
  }
  const deleteTemplate = async (item) => {
    setTemplateBusy(item.id); setError('')
    try {
      await api.deletePresentationTemplate(item.id)
      setTemplates((current) => current.map((entry) => entry.id === item.id ? { ...entry, cached: false, cached_version: '', update_available: false } : entry))
      setMessage(`已删除“${item.name}”的本地缓存`)
    } catch (err) { setError(err.message) } finally { setTemplateBusy('') }
  }

  const updateSlide = (index, patch) => setDeck((current) => ({ ...current, slides: current.slides.map((slide, itemIndex) => itemIndex === index ? { ...slide, ...patch } : slide) }))
  const moveSlide = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= deck.slides.length) return
    setDeck((current) => { const slides = [...current.slides]; [slides[index], slides[target]] = [slides[target], slides[index]]; return { ...current, slides } })
    setActiveIndex(target)
  }
  const removeSlide = (index) => {
    setDeck((current) => ({ ...current, slides: current.slides.filter((_, itemIndex) => itemIndex !== index) }))
    setActiveIndex((current) => Math.max(0, Math.min(current, deck.slides.length - 2)))
  }
  const addSlide = () => {
    const slide = { id: crypto.randomUUID(), title: '新页面', body: ['点击右侧大纲进行编辑'], notes: '', images: [] }
    setDeck((current) => ({ ...current, slides: [...current.slides, slide] })); setActiveIndex(deck.slides.length)
  }

  const exportDeck = async (format) => {
    if (!window.desktop?.exportPresentation) return setError('请在 OmniBox 桌面应用中导出演示')
    setExporting(format); setError(''); setMessage('')
    try {
      const result = await window.desktop.exportPresentation({ deck, style: themeId, format })
      if (result?.error) throw new Error(result.error)
      if (!result?.canceled) setMessage(`已导出：${result.path}`)
    } catch (err) { setError(err.message) } finally { setExporting('') }
  }

  const selectedTheme = themeById(themeId)
  return <motion.div className="page-scroll tool-page presentation-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
    <div className="tool-heading-row"><div className={`tool-icon large ${tool.color}`}><Presentation size={26} /></div><div><h1>{tool.title}</h1><p>{tool.description}</p></div></div>

    <section className="presentation-template-section"><div><LayoutTemplate size={16} /><span><strong>在线模板库</strong><small>只下载你选择的模板；下载后可以离线使用</small></span><button className="template-refresh" disabled={templateLoading} onClick={() => loadTemplates(true)}><RefreshCw className={templateLoading ? 'spin' : ''} size={12} />刷新目录</button></div><div>{templateLoading && !templates.length ? <div className="template-loading"><LoaderCircle className="spin" size={15} />正在读取在线目录…</div> : templates.map((item) => <article key={item.id}><button className="template-use" disabled={Boolean(templateBusy)} onClick={() => useTemplate(item)}><strong>{item.name}</strong><span>{item.detail}</span><small>{templateBusy === item.id ? '正在处理…' : item.update_available ? '有新版本 · 更新并使用' : item.cached ? '已下载 · 离线可用' : <><Cloud size={10} />在线 · 下载并使用</>}</small></button>{item.cached && <button className="template-delete" title="删除本地缓存" disabled={Boolean(templateBusy)} onClick={() => deleteTemplate(item)}><Trash2 size={11} /></button>}</article>)}</div>{templateWarning && <p>{templateWarning}</p>}</section>

    <div className="presentation-source-tabs"><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>从文件生成</button><button className={mode === 'markdown' ? 'active' : ''} onClick={() => setMode('markdown')}>从 Markdown 生成</button></div>
    <section className="workspace-card presentation-source-card">
      {mode === 'file' ? <button className={`presentation-drop ${source ? 'selected' : ''}`} onClick={choose}><FolderOpen size={22} /><span><strong>{source ? fileName(source) : '选择 Markdown、Word、Excel 或 PPTX'}</strong><small>{source || 'Excel 会自动识别数值列并生成图表；源文件不会被修改'}</small></span></button> : <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="粘贴 Markdown 大纲或长文，系统会按标题和语义标点分页…" />}
      <button className="primary-button presentation-generate" disabled={loading} onClick={extract}>{loading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={15} />}{loading ? '正在提取…' : '生成演示大纲'}</button>
    </section>
    {error && <div className="error-message presentation-message">{error}</div>}{message && <div className="success-message presentation-message">{message}</div>}

    {deck.slides.length > 0 && <>
      <section className="presentation-style-section"><div><strong>9 套视觉方向</strong><span>颜色、字体和页面结构会同步应用到 HTML、PDF 与可编辑 PPTX</span></div><div className="presentation-style-grid">{PRESENTATION_THEMES.map((item) => <button key={item.id} className={themeId === item.id ? 'active' : ''} onClick={() => setThemeId(item.id)}><SlideCanvas slide={deck.slides[0]} deckTitle={deck.title} themeId={item.id} compact /><strong>{item.name}</strong><span>{item.detail}</span></button>)}</div></section>
      <div className="presentation-workspace">
        <section className="workspace-card presentation-preview"><div className="presentation-panel-title"><span><MonitorPlay size={16} />演示预览</span><em>{activeIndex + 1} / {deck.slides.length} · {selectedTheme.name}</em></div><SlideCanvas slide={activeSlide} deckTitle={deck.title} themeId={themeId} /><div className="presentation-preview-nav"><button disabled={activeIndex === 0} onClick={() => setActiveIndex((value) => value - 1)}>上一页</button><button disabled={activeIndex === deck.slides.length - 1} onClick={() => setActiveIndex((value) => value + 1)}>下一页</button></div></section>
        <section className="workspace-card presentation-outline"><div className="presentation-panel-title"><span><FileText size={16} />页面大纲</span><button onClick={addSlide}><Plus size={14} />新增</button></div><label className="presentation-title-input"><span>演示标题</span><input value={deck.title} onChange={(event) => setDeck((current) => ({ ...current, title: event.target.value }))} /></label><div className="presentation-slide-list">{deck.slides.map((slide, index) => <article key={slide.id || index} className={activeIndex === index ? 'active' : ''} onClick={() => setActiveIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span><div><input value={slide.title} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSlide(index, { title: event.target.value })} /><textarea value={slide.body.join('\n')} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSlide(index, { body: event.target.value.split('\n').filter(Boolean).slice(0, 8) })} /><input className="presentation-notes" value={slide.notes || ''} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSlide(index, { notes: event.target.value })} placeholder="演讲者备注（可选）" /></div><nav><button disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveSlide(index, -1) }}><ArrowUp size={12} /></button><button disabled={index === deck.slides.length - 1} onClick={(event) => { event.stopPropagation(); moveSlide(index, 1) }}><ArrowDown size={12} /></button><button onClick={(event) => { event.stopPropagation(); removeSlide(index) }}><Trash2 size={12} /></button></nav></article>)}</div></section>
      </div>
      <section className="workspace-card presentation-quality"><div className="presentation-panel-title"><span>{allIssues.length ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}内容质量检查</span><button onClick={() => inspect()}><RefreshCw size={13} />重新检查</button></div><div className="presentation-quality-summary"><strong>{allIssues.length ? `${allIssues.length} 项待优化` : '当前未发现明显问题'}</strong><span>检查字号、页面密度、标题长度、配色数量和图片分辨率</span></div>{allIssues.length > 0 && <div className="presentation-issue-list">{allIssues.slice(0, 30).map((item, index) => <button key={`${item.page}-${item.code}-${index}`} className={item.severity} onClick={() => setActiveIndex(Math.max(0, item.page - 1))}><span>第 {item.page} 页</span><strong>{item.message}</strong></button>)}</div>}</section>
      <div className="presentation-export-bar"><div><strong>导出演示</strong><span>HTML 保留翻页效果；PDF 适合发送；PPTX 中的文本、表格和图表可继续编辑</span></div><div>{[['html', '网页 HTML'], ['pdf', '演示 PDF'], ['pptx', '可编辑 PPTX']].map(([format, label]) => <button key={format} disabled={Boolean(exporting)} onClick={() => exportDeck(format)}>{exporting === format ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{label}</button>)}</div></div>
      <p className="presentation-credit">视觉工作流借鉴 Frontend Slides；内容解析、质量检查、图表和导出均由 OmniBox 本地沙箱完成。</p>
    </>}
  </motion.div>
}
