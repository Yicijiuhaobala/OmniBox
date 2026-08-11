const fs = require('fs')
const os = require('os')
const path = require('path')
const PptxGenJS = require('pptxgenjs')
const themeDefinitions = require('../src/presentation-themes.json')


const FONT_CSS = {
  sans: "'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif",
  serif: "'Songti SC','STSong','Noto Serif CJK SC',serif",
  condensed: "'Avenir Next Condensed','PingFang SC','Microsoft YaHei',sans-serif",
  mono: "'SFMono-Regular','PingFang SC','Microsoft YaHei',monospace",
  rounded: "'Hiragino Maru Gothic ProN','Yuanti SC','Microsoft YaHei',sans-serif",
}
const THEMES = Object.fromEntries(themeDefinitions.map((item) => [item.id, { ...item, css: FONT_CSS[item.font] || FONT_CSS.sans }]))

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[character])

const cleanChart = (raw) => {
  if (!raw || !Array.isArray(raw.categories) || !Array.isArray(raw.series)) return null
  const categories = raw.categories.slice(0, 12).map((item) => String(item).slice(0, 80))
  const series = raw.series.slice(0, 4).map((item, index) => ({
    name: String(item?.name || `序列 ${index + 1}`).slice(0, 80),
    values: (Array.isArray(item?.values) ? item.values : []).slice(0, categories.length).map((value) => Number.isFinite(Number(value)) ? Number(value) : 0),
  })).filter((item) => item.values.length)
  return categories.length && series.length ? { type: 'bar', categories, series } : null
}

const cleanTable = (raw) => {
  if (!raw || !Array.isArray(raw.headers) || !Array.isArray(raw.rows)) return null
  const headers = raw.headers.slice(0, 8).map((item) => String(item).slice(0, 80))
  const rows = raw.rows.slice(0, 8).map((row) => (Array.isArray(row) ? row : []).slice(0, headers.length).map((item) => String(item ?? '').slice(0, 100)))
  return headers.length ? { headers, rows } : null
}

const cleanDeck = (raw = {}) => ({
  title: String(raw.title || '未命名演示').slice(0, 120),
  slides: (Array.isArray(raw.slides) ? raw.slides : []).slice(0, 80).map((slide, index) => ({
    title: String(slide.title || `第 ${index + 1} 页`).slice(0, 160),
    body: (Array.isArray(slide.body) ? slide.body : []).slice(0, 8).map((item) => String(item).slice(0, 500)),
    notes: String(slide.notes || '').slice(0, 4_000),
    images: (Array.isArray(slide.images) ? slide.images : []).slice(0, 3).filter((item) => /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(String(item?.data_url || ''))),
    chart: cleanChart(slide.chart),
    table: cleanTable(slide.table),
  })),
})

function renderChart(chart) {
  if (!chart) return ''
  const maximum = Math.max(1, ...chart.series.flatMap((item) => item.values.map((value) => Math.abs(value))))
  const rows = chart.categories.map((category, index) => `<div class="chart-row"><span>${escapeHtml(category)}</span><div>${chart.series.map((series) => {
    const value = series.values[index] || 0
    const width = Math.max(2, Math.min(100, Math.abs(value) / maximum * 100))
    return `<i style="--bar:${width}%" title="${escapeHtml(series.name)}：${escapeHtml(value)}"></i>`
  }).join('')}</div></div>`).join('')
  return `<div class="chart-card"><div class="chart-legend">${chart.series.map((series) => `<span>${escapeHtml(series.name)}</span>`).join('')}</div>${rows}</div>`
}

function renderTable(table) {
  if (!table) return ''
  return `<div class="table-card"><table><thead><tr>${table.headers.map((item) => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((item) => `<td>${escapeHtml(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function renderDeckHtml(rawDeck, styleName = 'executive') {
  const deck = cleanDeck(rawDeck)
  const theme = THEMES[styleName] || THEMES.executive
  const slides = deck.slides.map((slide, index) => {
    const images = slide.images.map((image) => `<img src="${image.data_url}" alt="">`).join('')
    const body = slide.body.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    const titleSlide = index === 0
    const visual = renderChart(slide.chart) || images && `<div class="media">${images}</div>` || renderTable(slide.table) || '<div class="shape" aria-hidden="true"></div>'
    return `<section class="slide layout-${theme.layout} ${titleSlide ? 'title-slide' : ''}" data-index="${index}">
      <div class="eyebrow">${titleSlide ? 'OMNIBOX PRESENTATION' : `${String(index + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}`}</div>
      <div class="slide-grid"><div class="copy"><h1>${escapeHtml(slide.title)}</h1>${body ? `<ul>${body}</ul>` : ''}</div>${visual}</div>
      <div class="footer"><span>${escapeHtml(deck.title)}</span><span>OmniBox</span></div>
    </section>`
  }).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(deck.title)}</title><style>
    :root{--bg:#${theme.bg};--panel:#${theme.panel};--ink:#${theme.ink};--muted:#${theme.muted};--accent:#${theme.accent};--accent2:#${theme.accent2};font-family:${theme.css}}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111}.viewport{position:fixed;inset:0;display:grid;place-items:center}.stage{position:relative;width:1920px;height:1080px;transform-origin:center;overflow:hidden;background:var(--bg)}.slide{visibility:hidden;opacity:0;pointer-events:none;position:absolute;inset:0;color:var(--ink);background:var(--bg);padding:108px 132px 72px;transition:opacity .35s ease}.slide.active{visibility:visible;opacity:1;pointer-events:auto}.eyebrow{color:var(--accent);font-size:21px;font-weight:800;letter-spacing:.16em}.slide-grid{height:770px;display:grid;grid-template-columns:minmax(0,1.16fr) minmax(420px,.84fr);align-items:center;gap:84px}.copy h1{max-width:1100px;margin:0 0 48px;font-size:82px;line-height:1.06;letter-spacing:-.035em}.copy ul{display:grid;gap:22px;margin:0;padding:0;list-style:none}.copy li{position:relative;color:var(--muted);font-size:31px;line-height:1.45;padding-left:31px}.copy li::before{content:'';position:absolute;left:0;top:.62em;width:11px;height:11px;border-radius:50%;background:var(--accent2)}.media,.chart-card,.table-card{height:620px;display:grid;gap:20px;align-content:center}.media img{width:100%;max-height:580px;object-fit:contain;border:1px solid color-mix(in srgb,var(--muted) 24%,transparent);border-radius:26px;background:var(--panel);box-shadow:0 30px 80px #0002}.shape{width:500px;height:500px;justify-self:center;border:2px solid var(--accent);border-radius:42% 58% 60% 40%;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent2) 36%,transparent));transform:rotate(-9deg)}.chart-card,.table-card{height:auto;align-self:center;border:1px solid color-mix(in srgb,var(--muted) 24%,transparent);border-radius:28px;background:var(--panel);padding:36px;box-shadow:0 25px 65px #0002}.chart-legend{display:flex;gap:22px;color:var(--muted);font-size:17px}.chart-legend span::before{content:'';display:inline-block;width:11px;height:11px;margin-right:8px;border-radius:50%;background:var(--accent)}.chart-legend span:nth-child(2)::before{background:var(--accent2)}.chart-row{display:grid;grid-template-columns:120px 1fr;align-items:center;gap:14px;color:var(--muted);font-size:17px}.chart-row>div{display:grid;gap:5px}.chart-row i{display:block;width:var(--bar);height:13px;border-radius:9px;background:var(--accent)}.chart-row i:nth-child(2){background:var(--accent2)}table{width:100%;border-collapse:collapse;font-size:15px}th,td{border-bottom:1px solid color-mix(in srgb,var(--muted) 22%,transparent);padding:10px;text-align:left}th{color:var(--ink);background:color-mix(in srgb,var(--accent) 10%,transparent)}td{color:var(--muted)}.title-slide .copy h1{font-size:104px}.title-slide .shape{border-radius:50% 22% 48% 28%;transform:rotate(14deg)}.footer{display:flex;justify-content:space-between;color:var(--muted);font-size:18px;border-top:1px solid color-mix(in srgb,var(--muted) 28%,transparent);padding-top:22px}.layout-minimal .shape{border:0;border-radius:0;background:linear-gradient(90deg,var(--accent),transparent);height:2px;transform:none}.layout-data .slide-grid{grid-template-columns:.82fr 1.18fr}.layout-academic{border-left:30px solid var(--accent)}.layout-blueprint{background-color:var(--bg);background-image:linear-gradient(#51d6e80b 1px,transparent 1px),linear-gradient(90deg,#51d6e80b 1px,transparent 1px);background-size:42px 42px}.layout-coral .shape{border:0;border-radius:26% 74% 32% 68%;background:linear-gradient(135deg,var(--accent),var(--accent2));}.layout-mono .eyebrow{color:var(--ink);border-bottom:5px solid var(--ink);padding-bottom:12px}.controls{position:fixed;right:20px;bottom:18px;display:flex;gap:8px;z-index:3}.controls button{width:40px;height:40px;color:#fff;border:1px solid #ffffff44;border-radius:10px;background:#111a;font-size:18px;cursor:pointer}@media(prefers-reduced-motion:reduce){.slide{transition:none}}@media print{@page{size:13.333333in 7.5in;margin:0}html,body{overflow:visible;background:#fff}.viewport{position:static;display:block}.stage{width:auto;height:auto;transform:none!important;overflow:visible}.slide{visibility:visible!important;opacity:1!important;position:relative;width:13.333333in;height:7.5in;page-break-after:always;padding:.75in .92in .5in}.controls{display:none}.slide-grid{height:5.35in;grid-template-columns:1.16fr .84fr;gap:.55in}.copy h1{font-size:40pt;margin-bottom:24pt}.title-slide .copy h1{font-size:54pt}.copy li{font-size:18pt}.shape{width:3.3in;height:3.3in}.media,.chart-card,.table-card{height:4.3in}.footer{font-size:10pt}}
  </style></head><body><main class="viewport"><div class="stage">${slides || '<section class="slide active"><h1>没有可显示的页面</h1></section>'}</div></main><nav class="controls"><button id="prev" aria-label="上一页">‹</button><button id="next" aria-label="下一页">›</button></nav><script>
    const slides=[...document.querySelectorAll('.slide')],stage=document.querySelector('.stage');let index=0;function fit(){const scale=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform='scale('+scale+')'}function show(value){index=(value+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle('active',i===index))}document.getElementById('prev').onclick=()=>show(index-1);document.getElementById('next').onclick=()=>show(index+1);addEventListener('keydown',event=>{if(['ArrowRight','PageDown',' '].includes(event.key))show(index+1);if(['ArrowLeft','PageUp'].includes(event.key))show(index-1);if(event.key==='Home')show(0);if(event.key==='End')show(slides.length-1)});addEventListener('resize',fit);fit();show(0)
  </script></body></html>`
}

function addPptxImage(slide, image, x, y, w, h) {
  try {
    slide.addImage({ data: image.data_url, x, y, w, h, sizing: 'contain' })
  } catch (_) {
    // A malformed image must not make the whole presentation unusable.
  }
}

async function writePptx(rawDeck, styleName, targetPath) {
  const deck = cleanDeck(rawDeck)
  const theme = THEMES[styleName] || THEMES.executive
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'OmniBox'
  pptx.subject = deck.title
  pptx.title = deck.title
  pptx.company = 'OmniBox'
  pptx.lang = 'zh-CN'
  const fontFace = theme.font === 'serif' ? 'Songti SC' : theme.font === 'mono' ? 'SF Mono' : 'Aptos'
  pptx.theme = { headFontFace: fontFace, bodyFontFace: fontFace, lang: 'zh-CN' }
  deck.slides.forEach((item, index) => {
    const slide = pptx.addSlide()
    slide.background = { color: theme.bg }
    slide.addText(index === 0 ? 'OMNIBOX PRESENTATION' : `${String(index + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}`, { x: .8, y: .42, w: 5.3, h: .25, fontFace: 'Aptos', fontSize: 10, bold: true, color: theme.accent, charSpacing: 2.1, margin: 0 })
    if (theme.layout === 'academic') slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: .22, h: 7.5, fill: { color: theme.accent }, line: { transparency: 100 } })
    if (theme.layout === 'data') slide.addShape(pptx.ShapeType.rect, { x: 8.1, y: .85, w: 4.65, h: 5.55, rectRadius: .12, fill: { color: theme.panel }, line: { color: theme.muted, transparency: 80 } })
    const hasVisual = item.images.length || item.chart || item.table
    slide.addText(item.title, { x: .8, y: 1.15, w: hasVisual ? 7.0 : 8.4, h: index === 0 ? 1.7 : 1.35, fontFace, fontSize: index === 0 ? 40 : 32, bold: true, color: theme.ink, breakLine: false, fit: 'shrink', margin: 0 })
    if (item.body.length) {
      slide.addText(item.body.map((text) => ({ text, options: { bullet: { indent: 18 }, hanging: 4, breakLine: true } })), { x: .88, y: index === 0 ? 3.05 : 2.62, w: hasVisual ? 6.6 : 8.1, h: 3.45, fontFace, fontSize: 17, color: theme.muted, breakLine: false, paraSpaceAfterPt: 11, valign: 'mid', margin: 0 })
    }
    if (item.chart) {
      const data = item.chart.series.map((series) => ({ name: series.name, labels: item.chart.categories, values: series.values }))
      slide.addChart(pptx.ChartType.bar, data, { x: 8.35, y: 1.35, w: 4.1, h: 4.75, catAxisLabelFontFace: fontFace, catAxisLabelFontSize: 9, valAxisLabelFontSize: 8, showLegend: true, legendFontSize: 8, showTitle: false, showValue: false, showCatName: false, chartColors: [theme.accent, theme.accent2, theme.muted, theme.ink], showBorder: false, showValue: true })
    } else if (item.images[0]) addPptxImage(slide, item.images[0], 8.45, 1.35, 4.2, 4.85)
    else if (item.table) {
      const rows = [item.table.headers, ...item.table.rows]
      slide.addTable(rows, { x: 8.15, y: 1.55, w: 4.35, h: 4.3, fontFace, fontSize: 8, color: theme.muted, border: { color: theme.muted, transparency: 72, pt: .6 }, fill: theme.panel, margin: .04, rowH: .34, bold: false })
    }
    else {
      slide.addShape(pptx.ShapeType.arc, { x: 9.0, y: 1.7, w: 3.4, h: 3.4, rotate: index === 0 ? 18 : -8, adjustPoint: .3, fill: { color: theme.accent, transparency: 72 }, line: { color: theme.accent, width: 1.2 } })
      slide.addShape(pptx.ShapeType.ellipse, { x: 10.3, y: 3.4, w: 1.45, h: 1.45, fill: { color: theme.accent2, transparency: 25 }, line: { transparency: 100 } })
    }
    slide.addShape(pptx.ShapeType.line, { x: .8, y: 6.75, w: 11.72, h: 0, line: { color: theme.muted, transparency: 70, width: .7 } })
    slide.addText(deck.title, { x: .8, y: 6.88, w: 7.5, h: .2, fontFace, fontSize: 8.5, color: theme.muted, margin: 0 })
    slide.addText('OmniBox', { x: 11.3, y: 6.88, w: 1.2, h: .2, align: 'right', fontFace, fontSize: 8.5, color: theme.muted, margin: 0 })
    if (item.notes) slide.addNotes(item.notes.split('\n').filter(Boolean))
  })
  await pptx.writeFile({ fileName: targetPath, compression: true })
}

function registerPresentationHandlers({ ipcMain, BrowserWindow, dialog }) {
  ipcMain.handle('presentation:export', async (_event, rawPayload = {}) => {
    const format = ['html', 'pdf', 'pptx'].includes(rawPayload.format) ? rawPayload.format : 'html'
    const deck = cleanDeck(rawPayload.deck)
    const style = THEMES[rawPayload.style] ? rawPayload.style : 'executive'
    if (!deck.slides.length) return { error: '没有可导出的演示页面' }
    const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'OmniBox 演示'
    const result = await dialog.showSaveDialog({
      title: `导出${format === 'pptx' ? '可编辑 PPTX' : format === 'pdf' ? '演示 PDF' : '网页演示'}`,
      defaultPath: `${safeName}.${format}`,
      filters: [{ name: format === 'pptx' ? 'PowerPoint 演示文稿' : format === 'pdf' ? 'PDF 文档' : 'HTML 网页', extensions: [format] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      if (format === 'pptx') await writePptx(deck, style, result.filePath)
      else if (format === 'html') await fs.promises.writeFile(result.filePath, renderDeckHtml(deck, style), 'utf8')
      else {
        const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'omnibox-slides-'))
        const htmlPath = path.join(temporary, 'slides.html')
        const printWindow = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
        try {
          await fs.promises.writeFile(htmlPath, renderDeckHtml(deck, style), 'utf8')
          await printWindow.loadFile(htmlPath)
          const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: true })
          await fs.promises.writeFile(result.filePath, pdf)
        } finally {
          if (!printWindow.isDestroyed()) printWindow.destroy()
          await fs.promises.rm(temporary, { recursive: true, force: true })
        }
      }
      return { canceled: false, path: result.filePath, format }
    } catch (error) {
      return { canceled: false, error: `导出失败：${error.message}` }
    }
  })
}

module.exports = { THEMES, renderDeckHtml, writePptx, registerPresentationHandlers }
