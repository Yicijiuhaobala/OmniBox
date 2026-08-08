const { contextBridge, clipboard, ipcRenderer } = require('electron')

const portArgument = process.argv.find((item) => item.startsWith('--omnibox-api-port='))
const apiPort = portArgument ? portArgument.split('=')[1] : '8000'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  apiBase: `http://127.0.0.1:${apiPort}/api`,
  copyText: (text) => clipboard.writeText(text),
  selectFiles: (kind) => ipcRenderer.invoke('files:select', kind),
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('path:show', targetPath),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  exportMarkdownPdf: (payload) => ipcRenderer.invoke('markdown:export-pdf', payload),
  exportSocialCardPng: (payload) => ipcRenderer.invoke('social-card:export-png', payload),
  clipboardHistory: {
    list: () => ipcRenderer.invoke('clipboard-history:list'),
    copy: (id) => ipcRenderer.invoke('clipboard-history:copy', id),
    delete: (id) => ipcRenderer.invoke('clipboard-history:delete', id),
    clear: () => ipcRenderer.invoke('clipboard-history:clear'),
    onChanged: (callback) => {
      const listener = (_event, entries) => callback(entries)
      ipcRenderer.on('clipboard-history:changed', listener)
      return () => ipcRenderer.removeListener('clipboard-history:changed', listener)
    },
  },
})
