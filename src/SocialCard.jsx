import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const CARD_THEMES = {
  paper: { label: '暖白纸张', background: 'linear-gradient(145deg, #f7f1e7 0%, #eee2d2 100%)', color: '#292724', accent: '#a65f38' },
  ink: { label: '深夜墨蓝', background: 'linear-gradient(145deg, #111821 0%, #202d3a 100%)', color: '#f3f1eb', accent: '#7ca7c9' },
  sunset: { label: '落日陶土', background: 'linear-gradient(145deg, #7b3f3c 0%, #c6755f 100%)', color: '#fff8ee', accent: '#ffd49a' },
  sage: { label: '鼠尾草绿', background: 'linear-gradient(145deg, #dce9df 0%, #f3efe5 100%)', color: '#25342d', accent: '#477661' },
  custom: { label: '自定义纯色', background: '#e9e1d5', color: '#292724', accent: '#8b5c3e' },
}

const FONT_OPTIONS = {
  sans: { label: '现代黑体', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif' },
  serif: { label: '人文宋体', value: '"Songti SC", "STSong", Georgia, serif' },
  rounded: { label: '圆体', value: '"Hiragino Maru Gothic ProN", "Yuanti SC", "Microsoft YaHei", sans-serif' },
  mono: { label: '等宽字体', value: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' },
}

const SAMPLE = `# 把复杂的事，讲清楚

真正有效的表达，不是堆叠更多术语，而是让读者在最短时间里抓住重点。

> 好的内容，不替读者思考；它让思考变得更容易。

## 三个简单原则

- 先写结论，再补依据
- 一段只说一件事
- 删除不影响含义的句子

愿每一次分享，都准确、克制，也有温度。`

function safeMarkdown(source, mode) {
  if (mode === 'text') {
    const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
    return source.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
  }
  return DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true }), {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
  })
}

function suggestedTitle(source) {
  const firstLine = source.split('\n').map((line) => line.trim()).find(Boolean) || '分享卡片'
  return firstLine.replace(/^#{1,6}\s*/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || '分享卡片'
}

export default function SocialCardPage({ tool, goHome }) {
  const [text, setText] = useState(SAMPLE)
  const [mode, setMode] = useState('markdown')
  const [theme, setTheme] = useState('paper')
  const [customBackground, setCustomBackground] = useState('#e9e1d5')
  const [customTextColor, setCustomTextColor] = useState('#292724')
  const [accent, setAccent] = useState('#a65f38')
  const [font, setFont] = useState('sans')
  const [quoteStyle, setQuoteStyle] = useState('line')
  const [width, setWidth] = useState(1080)
  const [fontSize, setFontSize] = useState(36)
  const [padding, setPadding] = useState(84)
  const [shadow, setShadow] = useState(true)
  const [signature, setSignature] = useState('OmniBox · 本地生成')
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [exportPath, setExportPath] = useState('')

  const html = useMemo(() => safeMarkdown(text, mode), [text, mode])
  const activeTheme = CARD_THEMES[theme]
  const background = theme === 'custom' ? customBackground : activeTheme.background
  const textColor = theme === 'custom' ? customTextColor : activeTheme.color
  const activeAccent = theme === 'custom' ? accent : activeTheme.accent
  const previewScale = 0.46
  const cardStyle = {
    '--card-background': background,
    '--card-color': textColor,
    '--card-accent': activeAccent,
    '--card-font': FONT_OPTIONS[font].value,
    '--card-font-size': `${Math.round(fontSize * previewScale)}px`,
    '--card-padding': `${Math.round(padding * previewScale)}px`,
  }

  const exportPng = async () => {
    if (!text.trim()) return setMessage('请先输入要生成的内容。')
    if (!window.desktop?.exportSocialCardPng) return setMessage('PNG 导出仅在 OmniBox 桌面应用中可用。')
    setExporting(true)
    setMessage('')
    setExportPath('')
    try {
      const result = await window.desktop.exportSocialCardPng({
        title: suggestedTitle(text), html, theme, customBackground, customTextColor, accent,
        font, quoteStyle, width, fontSize, padding, shadow, signature,
      })
      if (result?.error) setMessage(result.error)
      else if (!result?.canceled) {
        setExportPath(result.path)
        setMessage(`已导出 ${result.width} × ${result.height} PNG`)
      }
    } catch (error) {
      setMessage(`导出失败：${error.message}`)
    } finally {
      setExporting(false)
    }
  }

  const Icon = tool.icon
  return (
    <motion.div className="page-scroll tool-page social-card-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
      <div className="tool-heading-row">
        <div className={`tool-icon large ${tool.color}`}><Icon size={26} /></div>
        <div><div className="title-with-badge"><h1>{tool.title}</h1><span className="local-only-badge">纯本地</span></div><p>{tool.description}</p></div>
      </div>

      <div className="social-card-workspace">
        <section className="social-card-controls">
          <div className="social-card-tabs">
            <button className={mode === 'markdown' ? 'active' : ''} onClick={() => setMode('markdown')}>Markdown</button>
            <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>纯文本</button>
          </div>
          <label className="social-card-field social-card-editor">
            <span><strong>内容</strong><small>{text.length} 字符</small></span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="输入文本或 Markdown…" />
          </label>

          <fieldset className="social-card-options">
            <legend>卡片外观</legend>
            <div className="theme-swatches">
              {Object.entries(CARD_THEMES).map(([id, item]) => (
                <button key={id} className={theme === id ? 'active' : ''} onClick={() => setTheme(id)} title={item.label}>
                  <i style={{ background: item.background }} /><span>{item.label}</span>
                </button>
              ))}
            </div>
            {theme === 'custom' && <div className="color-controls">
              <label>背景色<input type="color" value={customBackground} onChange={(event) => setCustomBackground(event.target.value)} /></label>
              <label>文字色<input type="color" value={customTextColor} onChange={(event) => setCustomTextColor(event.target.value)} /></label>
              <label>强调色<input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
            </div>}
            <div className="social-card-option-grid">
              <label>字体<select value={font} onChange={(event) => setFont(event.target.value)}>{Object.entries(FONT_OPTIONS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
              <label>金句样式<select value={quoteStyle} onChange={(event) => setQuoteStyle(event.target.value)}><option value="line">左侧引线</option><option value="panel">留白卡片</option><option value="statement">大字金句</option></select></label>
              <label>图片宽度<select value={width} onChange={(event) => setWidth(Number(event.target.value))}><option value={720}>720 px</option><option value={900}>900 px</option><option value={1080}>1080 px</option></select></label>
              <label>落款<input value={signature} maxLength={80} onChange={(event) => setSignature(event.target.value)} placeholder="可留空" /></label>
            </div>
            <label className="range-control"><span>字号 <b>{fontSize}px</b></span><input type="range" min="26" max="52" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
            <label className="range-control"><span>页边距 <b>{padding}px</b></span><input type="range" min="40" max="120" step="4" value={padding} onChange={(event) => setPadding(Number(event.target.value))} /></label>
            <label className="shadow-switch"><input type="checkbox" checked={shadow} onChange={(event) => setShadow(event.target.checked)} /><span>内容区域使用柔和阴影</span></label>
          </fieldset>

          <div className="social-card-export-row">
            <span><ShieldCheck size={14} /> 内容仅在本机渲染</span>
            <button className="primary-button" disabled={exporting} onClick={exportPng}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{exporting ? '正在导出' : '导出 PNG'}</button>
          </div>
          {message && <div className={`social-card-message ${exportPath ? 'success' : ''}`}><span>{message}</span>{exportPath && <button onClick={() => window.desktop.showItemInFolder(exportPath)}><FolderOpen size={14} /> 在文件夹中显示</button>}</div>}
        </section>

        <section className="social-card-preview-panel">
          <header><span>实时预览</span><small>导出宽度 {width}px · 高度随内容增长</small></header>
          <div className="social-card-stage">
            <article className={`social-card-canvas quote-${quoteStyle} ${shadow ? 'with-shadow' : ''}`} style={cardStyle}>
              <div className="social-card-decoration" />
              <div className="social-card-content" dangerouslySetInnerHTML={{ __html: html }} />
              {signature.trim() && <footer>{signature}</footer>}
            </article>
          </div>
        </section>
      </div>
    </motion.div>
  )
}
