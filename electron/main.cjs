const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')

let apiProcess = null

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
  if (!app.isPackaged) return
  const executable = process.platform === 'win32' ? 'omnibox-backend.exe' : 'omnibox-backend'
  const backendPath = path.join(process.resourcesPath, 'backend', executable)
  apiProcess = spawn(backendPath, [], {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OMNIBOX_API_PORT: String(port) },
  })
}

async function createWindow() {
  const apiPort = app.isPackaged ? await findAvailablePort() : 8000
  startProductionApi(apiPort)
  try {
    await waitForApi(`http://127.0.0.1:${apiPort}/api/health`)
  } catch (error) {
    console.error(error)
  }

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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill()
})
