const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { fileURLToPath } = require('url')

const HISTORY_LIMIT = 50
const POLL_INTERVAL_MS = 800
const MAX_TEXT_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const LOCAL_FILE_FORMATS = [
  'public.file-url', 'NSFilenamesPboardType', 'text/uri-list',
  'x-special/gnome-copied-files', 'FileNameW', 'FileName',
]
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.ico', '.icns'])
const MAX_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 2048
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i

function contentHash(type, content) {
  return crypto.createHash('sha256').update(type).update('\0').update(content).digest('hex')
}

function imageSourceFromHtml(html) {
  if (!html) return ''
  const match = html.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
  return (match?.[1] || match?.[2] || match?.[3] || '').replaceAll('&amp;', '&').trim()
}

function decodedClipboardValues(value) {
  if (!value) return []
  if (typeof value === 'string') return [value]
  if (!Buffer.isBuffer(value) || !value.length) return []
  const utf8 = value.toString('utf8')
  const utf16 = value.length % 2 === 0 ? value.toString('utf16le') : ''
  return [...new Set([utf8, utf16].filter(Boolean))]
}

function localPathCandidates(value) {
  const candidates = []
  for (const decoded of decodedClipboardValues(value)) {
    const normalized = decoded.replaceAll('\0', '\n').replaceAll('&amp;', '&')
    for (const match of normalized.matchAll(/file:\/\/[^\s<>"']+/gi)) candidates.push(match[0])
    for (const match of normalized.matchAll(/<string>([^<]+)<\/string>/gi)) candidates.push(match[1])
    for (const line of normalized.split(/[\r\n]+/)) {
      const candidate = line.trim().replace(/^copy\s+/i, '').replace(/^['"]|['"]$/g, '')
      if (candidate.startsWith('/') || /^[a-z]:[\\/]/i.test(candidate)) candidates.push(candidate)
    }
  }
  return [...new Set(candidates)]
}

function resolveImagePath(candidate) {
  try {
    const localPath = candidate.toLowerCase().startsWith('file://')
      ? fileURLToPath(candidate)
      : candidate
    if (!path.isAbsolute(localPath) || !IMAGE_EXTENSIONS.has(path.extname(localPath).toLowerCase())) return ''
    return fs.statSync(localPath).isFile() ? localPath : ''
  } catch {
    return ''
  }
}

function validEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.hash !== 'string') return false
  if (entry.type === 'text') return typeof entry.text === 'string'
  if (entry.type === 'image') return typeof entry.data === 'string' && typeof entry.thumbnail === 'string'
  return false
}

class ClipboardHistoryService {
  constructor({ app, BrowserWindow, clipboard, ipcMain, nativeImage }) {
    this.app = app
    this.BrowserWindow = BrowserWindow
    this.clipboard = clipboard
    this.ipcMain = ipcMain
    this.nativeImage = nativeImage
    this.entries = []
    this.lastClipboardHash = ''
    this.pollTimer = null
    this.persistQueue = Promise.resolve()
    this.historyPath = ''
  }

  async start() {
    this.historyPath = path.join(this.app.getPath('userData'), 'clipboard-history.json')
    await this.load()
    this.lastClipboardHash = this.readCurrent()?.hash || ''
    this.registerIpc()
    this.pollTimer = setInterval(() => this.capture(), POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  registerIpc() {
    this.ipcMain.handle('clipboard-history:list', () => this.publicEntries())
    this.ipcMain.handle('clipboard-history:copy', (_event, id) => this.copyEntry(id))
    this.ipcMain.handle('clipboard-history:delete', (_event, id) => this.deleteEntry(id))
    this.ipcMain.handle('clipboard-history:clear', () => this.clear())
  }

  async load() {
    try {
      const content = await fs.promises.readFile(this.historyPath, 'utf8')
      const parsed = JSON.parse(content)
      this.entries = Array.isArray(parsed) ? parsed.filter(validEntry).slice(0, HISTORY_LIMIT) : []
      this.enforceLimits()
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Failed to load clipboard history:', error)
      this.entries = []
    }
  }

  readCurrent() {
    try {
      const formats = this.clipboard.availableFormats()
      const image = this.clipboard.readImage()
      const imageSource = formats.some((available) => LOCAL_FILE_FORMATS.some((format) => available.toLowerCase() === format.toLowerCase()))
        ? 'local-image-file'
        : 'clipboard-image'
      const imageClipboardCandidate = this.imageCandidate(image, imageSource)
      if (imageClipboardCandidate) return imageClipboardCandidate

      const localImage = this.readLocalImage(formats)
      if (localImage) return localImage

      const html = this.clipboard.readHTML?.() || ''
      const htmlImageSource = imageSourceFromHtml(html)
      if (SAFE_DATA_IMAGE_PATTERN.test(htmlImageSource) && htmlImageSource.length <= MAX_DATA_URL_LENGTH) {
        const image = this.nativeImage.createFromDataURL(htmlImageSource)
        const candidate = this.imageCandidate(image, 'html-data-image')
        if (candidate) return candidate
      }

      if (/^https?:\/\//i.test(htmlImageSource)) {
        const content = Buffer.from(htmlImageSource, 'utf8')
        return { type: 'text', content, hash: contentHash('text', content), text: htmlImageSource, source: 'web-url' }
      }

      const text = this.clipboard.readText()
      if (text.length) {
        const textImage = this.readLocalImageFromValues([text])
        if (textImage) return textImage
        const content = Buffer.from(text, 'utf8')
        return {
          type: 'text', content, hash: contentHash('text', content), text,
          source: /^https?:\/\//i.test(text.trim()) ? 'web-url' : 'clipboard-text',
        }
      }

    } catch (error) {
      console.error('Failed to read clipboard:', error)
    }
    return null
  }

  imageCandidate(image, source) {
    if (!image || image.isEmpty()) return null
    const png = image.toPNG()
    if (!png.length) return null
    return { type: 'image', content: png, hash: contentHash('image', png), image, source }
  }

  readLocalImage(formats) {
    const values = []
    for (const format of LOCAL_FILE_FORMATS) {
      if (!formats.some((available) => available.toLowerCase() === format.toLowerCase())) continue
      try { values.push(this.clipboard.read?.(format)) } catch { /* Some native formats only expose a buffer. */ }
      try { values.push(this.clipboard.readBuffer?.(format)) } catch { /* Continue with other file formats. */ }
    }
    return this.readLocalImageFromValues(values)
  }

  readLocalImageFromValues(values) {
    for (const value of values) {
      for (const candidate of localPathCandidates(value)) {
        const localPath = resolveImagePath(candidate)
        if (!localPath) continue
        const image = this.nativeImage.createFromPath(localPath)
        const result = this.imageCandidate(image, 'local-image-file')
        if (result) return result
      }
    }
    return null
  }

  capture() {
    const current = this.readCurrent()
    if (!current || current.hash === this.lastClipboardHash) return
    this.lastClipboardHash = current.hash

    const existingIndex = this.entries.findIndex((entry) => entry.hash === current.hash)
    if (existingIndex >= 0) {
      const [entry] = this.entries.splice(existingIndex, 1)
      entry.createdAt = new Date().toISOString()
      this.entries.unshift(entry)
      this.changed()
      return
    }

    const now = new Date().toISOString()
    if (current.type === 'text') {
      if (current.content.length > MAX_TEXT_BYTES) return
      this.entries.unshift({
        id: `${Date.now()}-${current.hash.slice(0, 12)}`,
        type: 'text',
        text: current.text,
        characterCount: current.text.length,
        byteSize: current.content.length,
        createdAt: now,
        hash: current.hash,
        source: current.source,
      })
    } else {
      if (current.content.length > MAX_IMAGE_BYTES) return
      const size = current.image.getSize()
      const scale = Math.min(1, 320 / size.width, 240 / size.height)
      const thumbnail = scale < 1 ? current.image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good',
      }) : current.image
      this.entries.unshift({
        id: `${Date.now()}-${current.hash.slice(0, 12)}`,
        type: 'image',
        data: current.content.toString('base64'),
        thumbnail: thumbnail.toDataURL(),
        width: size.width,
        height: size.height,
        byteSize: current.content.length,
        createdAt: now,
        hash: current.hash,
        source: current.source,
      })
    }
    this.enforceLimits()
    this.changed()
  }

  enforceLimits() {
    this.entries = this.entries.slice(0, HISTORY_LIMIT)
    let total = this.entries.reduce((sum, entry) => sum + Number(entry.byteSize || 0), 0)
    while (this.entries.length && total > MAX_TOTAL_BYTES) {
      const removed = this.entries.pop()
      total -= Number(removed.byteSize || 0)
    }
  }

  publicEntries() {
    return this.entries.map((entry) => entry.type === 'text' ? {
      id: entry.id,
      type: entry.type,
      preview: entry.text.slice(0, 4000),
      truncated: entry.text.length > 4000,
      characterCount: entry.characterCount ?? entry.text.length,
      byteSize: entry.byteSize,
      createdAt: entry.createdAt,
      source: entry.source,
    } : {
      id: entry.id,
      type: entry.type,
      thumbnail: entry.thumbnail,
      width: entry.width,
      height: entry.height,
      byteSize: entry.byteSize,
      createdAt: entry.createdAt,
      source: entry.source,
    })
  }

  copyEntry(id) {
    const index = this.entries.findIndex((entry) => entry.id === id)
    if (index < 0) return { ok: false, error: '这条剪贴板记录已不存在' }
    const [entry] = this.entries.splice(index, 1)
    try {
      if (entry.type === 'text') {
        this.clipboard.writeText(entry.text)
      } else {
        const image = this.nativeImage.createFromBuffer(Buffer.from(entry.data, 'base64'))
        if (image.isEmpty()) throw new Error('图片数据已损坏')
        this.clipboard.writeImage(image)
      }
      entry.createdAt = new Date().toISOString()
      this.entries.unshift(entry)
      this.lastClipboardHash = entry.hash
      this.changed()
      return { ok: true }
    } catch (error) {
      this.entries.splice(index, 0, entry)
      return { ok: false, error: `复制失败：${error.message}` }
    }
  }

  deleteEntry(id) {
    const next = this.entries.filter((entry) => entry.id !== id)
    if (next.length === this.entries.length) return { ok: false }
    this.entries = next
    this.changed()
    return { ok: true }
  }

  clear() {
    this.entries = []
    this.changed()
    return { ok: true }
  }

  changed() {
    const entries = this.publicEntries()
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(() => this.persist())
    for (const window of this.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('clipboard-history:changed', entries)
    }
  }

  async persist() {
    const temporaryPath = `${this.historyPath}.tmp`
    const content = JSON.stringify(this.entries)
    await fs.promises.mkdir(path.dirname(this.historyPath), { recursive: true })
    await fs.promises.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
    try {
      await fs.promises.rename(temporaryPath, this.historyPath)
    } catch {
      await fs.promises.writeFile(this.historyPath, content, { encoding: 'utf8', mode: 0o600 })
      await fs.promises.unlink(temporaryPath).catch(() => undefined)
    }
    if (process.platform !== 'win32') await fs.promises.chmod(this.historyPath, 0o600).catch(() => undefined)
  }
}

function createClipboardHistoryService(dependencies) {
  return new ClipboardHistoryService(dependencies)
}

module.exports = { createClipboardHistoryService }
