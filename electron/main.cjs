const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')
const { createClipboardHistoryService } = require('./clipboard-history.cjs')

let apiProcess = null
let apiPort = 8000
let isQuitting = false
const clipboardHistory = createClipboardHistoryService({ app, BrowserWindow, clipboard, ipcMain, nativeImage })

ipcMain.handle('files:select', async (_event, kind = 'documents') => {
  const filters = {
    documents: [{ name: '文档', extensions: ['pdf', 'docx', 'xlsx', 'csv', 'txt'] }],
    summary: [{ name: 'PDF、Word、Excel', extensions: ['pdf', 'docx', 'xlsx'] }],
    convert: [{ name: '可转换文件', extensions: ['pdf', 'docx', 'xlsx', 'csv', 'txt'] }],
    images: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    identity_images: [{ name: '证件图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    office: [{ name: 'Excel 或 Word', extensions: ['xlsx', 'xlsm', 'docx'] }],
    excel: [{ name: 'Excel 工作簿', extensions: ['xlsx', 'xlsm'] }],
    word: [{ name: 'Word 文档', extensions: ['docx'] }],
    ocr: [{ name: 'OCR 图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    any: [{ name: '所有文件', extensions: ['*'] }],
  }
  const result = await dialog.showOpenDialog({
    title: '选择文件',
    properties: ['openFile', 'multiSelections'],
    filters: filters[kind] || filters.documents,
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('directory:select', async () => {
  const result = await dialog.showOpenDialog({ title: '选择输出文件夹', properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? '' : result.filePaths[0]
})

ipcMain.handle('path:show', async (_event, targetPath) => {
  if (targetPath) shell.showItemInFolder(targetPath)
})

ipcMain.on('theme:set', (event, theme) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target) return
  const light = theme === 'light'
  target.setBackgroundColor(light ? '#f3f5f7' : '#111315')
  if (process.platform !== 'darwin' && target.setTitleBarOverlay) {
    target.setTitleBarOverlay({ color: light ? '#ffffff' : '#0c0d11', symbolColor: light ? '#4f5963' : '#a7abb8', height: 42 })
  }
})

ipcMain.handle('markdown:export-pdf', async (_event, { title = 'Markdown 文档', html = '' } = {}) => {
  const safeName = String(title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'Markdown 文档'
  const result = await dialog.showSaveDialog({
    title: '导出 Markdown 为 PDF',
    defaultPath: `${safeName}.pdf`,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${safeName}</title><style>
    @page { size: A4; margin: 18mm 17mm; } body { color: #202124; font: 12px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1,h2,h3,h4 { color: #17191c; line-height: 1.3; margin: 1.4em 0 .55em; } h1 { font-size: 25px; border-bottom: 1px solid #dfe2e5; padding-bottom: 8px; }
    h2 { font-size: 19px; } h3 { font-size: 15px; } p { margin: .65em 0; } a { color: #245f9e; } blockquote { color: #57606a; border-left: 3px solid #b8c0c8; margin-left: 0; padding-left: 12px; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; background: #f1f3f5; border-radius: 3px; padding: 1px 4px; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; background: #f4f5f6; border: 1px solid #e0e2e4; border-radius: 5px; padding: 11px; } pre code { background: none; padding: 0; }
    table { width: 100%; border-collapse: collapse; } th,td { border: 1px solid #cfd4d8; padding: 6px 8px; text-align: left; } img { max-width: 100%; }
  </style></head><body>${html}</body></html>`
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`)
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    const fs = require('fs')
    await fs.promises.writeFile(result.filePath, pdf)
    return { canceled: false, path: result.filePath }
  } catch (error) {
    return { canceled: false, error: `PDF 导出失败：${error.message}` }
  } finally {
    printWindow.destroy()
  }
})

const SOCIAL_CARD_THEMES = {
  paper: { background: 'linear-gradient(145deg, #f7f1e7 0%, #eee2d2 100%)', color: '#292724', accent: '#a65f38' },
  ink: { background: 'linear-gradient(145deg, #111821 0%, #202d3a 100%)', color: '#f3f1eb', accent: '#7ca7c9' },
  sunset: { background: 'linear-gradient(145deg, #7b3f3c 0%, #c6755f 100%)', color: '#fff8ee', accent: '#ffd49a' },
  sage: { background: 'linear-gradient(145deg, #dce9df 0%, #f3efe5 100%)', color: '#25342d', accent: '#477661' },
}
const SOCIAL_CARD_FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "STSong", Georgia, serif',
  rounded: '"Hiragino Maru Gothic ProN", "Yuanti SC", "Microsoft YaHei", sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
}
const clampNumber = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback
const safeHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])

ipcMain.handle('social-card:export-png', async (_event, payload = {}) => {
  const title = String(payload.title || '分享卡片').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '分享卡片'
  const targetWidth = [720, 900, 1080].includes(Number(payload.width)) ? Number(payload.width) : 1080
  const fontSize = clampNumber(payload.fontSize, 26, 52, 36)
  const padding = clampNumber(payload.padding, 40, 120, 84)
  const theme = SOCIAL_CARD_THEMES[payload.theme] || {
    background: safeHex(payload.customBackground, '#e9e1d5'),
    color: safeHex(payload.customTextColor, '#292724'),
    accent: safeHex(payload.accent, '#8b5c3e'),
  }
  const font = SOCIAL_CARD_FONTS[payload.font] || SOCIAL_CARD_FONTS.sans
  const quoteStyle = ['line', 'panel', 'statement'].includes(payload.quoteStyle) ? payload.quoteStyle : 'line'
  const signature = String(payload.signature || '').slice(0, 80)
  const html = String(payload.html || '').slice(0, 500_000)
  if (!html.trim()) return { canceled: false, error: '没有可导出的内容。' }

  const result = await dialog.showSaveDialog({
    title: '导出文本长图',
    defaultPath: `${title}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const scaleFactor = Math.max(1, screen.getPrimaryDisplay().scaleFactor || 1)
  const cssWidth = Math.max(360, Math.round(targetWidth / scaleFactor))
  const cssFontSize = fontSize / scaleFactor
  const cssPadding = padding / scaleFactor
  const exportWindow = new BrowserWindow({
    show: false,
    width: cssWidth,
    height: 800,
    backgroundColor: theme.color,
    webPreferences: { sandbox: true, contextIsolation: true },
  })
  const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(title)}</title><style>
    * { box-sizing: border-box; } html, body { width: ${cssWidth}px; min-height: 100%; margin: 0; }
    body { overflow: hidden; color: ${theme.color}; background: ${theme.background}; font: ${cssFontSize}px/1.72 ${font}; overflow-wrap: anywhere; }
    .card { position: relative; width: 100%; min-height: ${Math.round(cssWidth * .72)}px; overflow: hidden; padding: ${cssPadding}px; }
    .card::before { content: ''; position: absolute; width: 55%; aspect-ratio: 1; right: -23%; top: -14%; border: 1px solid ${theme.accent}2e; border-radius: 50%; }
    .card::after { content: ''; position: absolute; width: 34%; aspect-ratio: 1; left: -17%; bottom: -10%; background: ${theme.accent}12; border-radius: 50%; filter: blur(2px); }
    .content { position: relative; z-index: 1; ${payload.shadow ? `border: 1px solid ${theme.accent}24; border-radius: ${20 / scaleFactor}px; background: rgba(255,255,255,.075); box-shadow: 0 ${20 / scaleFactor}px ${65 / scaleFactor}px rgba(13,18,24,.16); padding: ${cssPadding * .72}px;` : ''} }
    .content > :first-child { margin-top: 0; } .content > :last-child { margin-bottom: 0; }
    h1,h2,h3,h4 { color: inherit; line-height: 1.24; letter-spacing: -.025em; margin: 1.25em 0 .5em; }
    h1 { font-size: 1.72em; } h2 { font-size: 1.3em; } h3 { font-size: 1.1em; }
    p { margin: .72em 0; } strong { color: ${theme.accent}; font-weight: 700; } a { color: ${theme.accent}; text-decoration-thickness: 1px; }
    ul,ol { margin: .75em 0; padding-left: 1.35em; } li + li { margin-top: .3em; } li::marker { color: ${theme.accent}; }
    hr { height: 1px; border: 0; background: ${theme.accent}40; margin: 1.5em 0; }
    blockquote { margin: 1.2em 0; color: inherit; }
    .quote-line blockquote { border-left: .14em solid ${theme.accent}; padding: .2em 0 .2em .85em; }
    .quote-panel blockquote { border: 1px solid ${theme.accent}3d; border-radius: .55em; background: rgba(255,255,255,.1); padding: .85em 1em; }
    .quote-statement blockquote { color: ${theme.accent}; font-size: 1.42em; font-weight: 700; line-height: 1.46; text-align: center; padding: .75em .3em; }
    blockquote p { margin: 0; } code { border-radius: .24em; background: rgba(0,0,0,.11); padding: .08em .28em; font-family: ${SOCIAL_CARD_FONTS.mono}; font-size: .84em; }
    pre { overflow: hidden; white-space: pre-wrap; border: 1px solid ${theme.accent}30; border-radius: .5em; background: rgba(0,0,0,.13); padding: .85em; }
    pre code { background: none; padding: 0; } table { width: 100%; border-collapse: collapse; font-size: .78em; }
    th,td { border: 1px solid ${theme.accent}35; padding: .48em .58em; text-align: left; } th { color: ${theme.accent}; }
    footer { position: relative; z-index: 1; margin-top: ${cssPadding * .62}px; color: ${theme.color}a8; font-size: .54em; letter-spacing: .08em; text-align: right; }
  </style></head><body><main class="card quote-${quoteStyle}"><section class="content">${html}</section>${signature.trim() ? `<footer>${escapeHtml(signature)}</footer>` : ''}</main></body></html>`

  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`)
    const cssHeight = await exportWindow.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')
    if (!Number.isFinite(cssHeight) || cssHeight < 1) throw new Error('无法测量卡片高度')
    if (cssHeight * scaleFactor > 16_000) return { canceled: false, error: '内容过长，生成图片会超过 16000px。请缩小字号、页边距或分段导出。' }
    exportWindow.setContentSize(cssWidth, cssHeight, false)
    const captured = await exportWindow.webContents.capturePage({ x: 0, y: 0, width: cssWidth, height: cssHeight })
    if (captured.isEmpty()) throw new Error('未能捕获卡片画面')
    const resized = captured.getSize().width === targetWidth ? captured : captured.resize({ width: targetWidth, quality: 'best' })
    const size = resized.getSize()
    const fs = require('fs')
    await fs.promises.writeFile(result.filePath, resized.toPNG())
    return { canceled: false, path: result.filePath, width: size.width, height: size.height }
  } catch (error) {
    return { canceled: false, error: `PNG 导出失败：${error.message}` }
  } finally {
    if (!exportWindow.isDestroyed()) exportWindow.destroy()
  }
})

function waitForApi(url, attempts = 150) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      http.get(url, (response) => {
        response.resume()
        if (response.statusCode === 200) return resolve()
        retry(remaining)
      }).on('error', () => retry(remaining))
    }
    const retry = (remaining) => {
      if (remaining <= 0) return reject(new Error('Local API did not start'))
      setTimeout(() => check(remaining - 1), 200)
    }
    check(attempts)
  })
}

function findAvailablePort(start = 8000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && start < 8100) resolve(findAvailablePort(start + 1))
      else reject(error)
    })
    server.listen(start, '127.0.0.1', () => server.close(() => resolve(start)))
  })
}

function startProductionApi(port) {
  if (!app.isPackaged || apiProcess) return
  const executable = process.platform === 'win32' ? 'omnibox-backend.exe' : 'omnibox-backend'
  const backendPath = path.join(process.resourcesPath, 'backend', executable)
  const child = spawn(backendPath, [], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: { ...process.env, OMNIBOX_API_PORT: String(port) },
  })
  apiProcess = child
  child.once('exit', () => {
    if (apiProcess === child) apiProcess = null
  })
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
  })
}

function signalApiProcess(child, signal) {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const args = ['/pid', String(child.pid), '/T']
      if (signal === 'SIGKILL') args.push('/F')
      const taskkill = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true })
      taskkill.once('error', resolve)
      taskkill.once('exit', resolve)
    })
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`Failed to stop local API with ${signal}:`, error)
  }
  return Promise.resolve()
}

async function stopProductionApi() {
  const child = apiProcess
  apiProcess = null
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  await signalApiProcess(child, 'SIGTERM')
  const exited = await waitForProcessExit(child, 1500)
  if (exited) return

  await signalApiProcess(child, 'SIGKILL')
  await waitForProcessExit(child, 1500)
}

async function startLocalApi() {
  apiPort = app.isPackaged ? await findAvailablePort() : 8000
  startProductionApi(apiPort)
  try {
    await waitForApi(`http://127.0.0.1:${apiPort}/api/health`)
  } catch (error) {
    console.error(error)
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : {
      color: '#0c0d11',
      symbolColor: '#a7abb8',
      height: 42,
    },
    backgroundColor: '#111315',
    icon: app.isPackaged ? path.join(__dirname, '..', 'dist', 'omnibox-icon.png') : path.join(__dirname, '..', 'public', 'omnibox-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--omnibox-api-port=${apiPort}`],
    },
  })

  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    await window.loadURL('http://localhost:5173')
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  await clipboardHistory.start()
  await startLocalApi()
  await createWindow()
})
app.on('window-all-closed', () => {
  app.quit()
})
app.on('activate', () => {
  if (!isQuitting && BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  Promise.resolve()
    .then(() => clipboardHistory.stop())
    .catch((error) => console.error('Failed to stop clipboard history:', error))
    .then(() => stopProductionApi())
    .catch((error) => console.error('Failed to stop local API:', error))
    .finally(() => app.quit())
})
