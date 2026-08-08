const API_BASE = window.desktop?.apiBase || 'http://127.0.0.1:8000/api'

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new Error('本地服务暂时不可用，请稍后重试')
  }

  let data = {}
  try {
    data = await response.json()
  } catch {
    // Let the status fallback below provide a useful message.
  }
  if (!response.ok) throw new Error(data.detail || `请求失败（${response.status}）`)
  return data
}

export const api = {
  health: () => request('/health'),
  settings: () => request('/settings'),
  saveSettings: (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  runBasic: (payload) => request('/tools/basic', { method: 'POST', body: JSON.stringify(payload) }),
  runAI: (payload) => request('/tools/ai', { method: 'POST', body: JSON.stringify(payload) }),
  summarizeFiles: (payload) => request('/files/summarize', { method: 'POST', body: JSON.stringify(payload) }),
  convertFiles: (payload) => request('/files/convert', { method: 'POST', body: JSON.stringify(payload) }),
  renameFiles: (payload) => request('/files/rename', { method: 'POST', body: JSON.stringify(payload) }),
  structured: (payload) => request('/advanced/structured', { method: 'POST', body: JSON.stringify(payload) }),
  codec: (payload) => request('/advanced/codec', { method: 'POST', body: JSON.stringify(payload) }),
  time: (payload) => request('/advanced/time', { method: 'POST', body: JSON.stringify(payload) }),
  textLab: (payload) => request('/advanced/text', { method: 'POST', body: JSON.stringify(payload) }),
  image: (payload) => request('/advanced/image', { method: 'POST', body: JSON.stringify(payload) }),
  imageInfo: (payload) => request('/advanced/image-info', { method: 'POST', body: JSON.stringify(payload) }),
  watermark: (payload) => request('/advanced/watermark', { method: 'POST', body: JSON.stringify(payload) }),
  network: (payload) => request('/advanced/network', { method: 'POST', body: JSON.stringify(payload) }),
  officeFormula: (payload) => request('/office/formula', { method: 'POST', body: JSON.stringify(payload) }),
  officeProcess: (payload) => request('/office/process', { method: 'POST', body: JSON.stringify(payload) }),
  hybridTranslate: (payload) => request('/hybrid/translate', { method: 'POST', body: JSON.stringify(payload) }),
  hybridCode: (payload) => request('/hybrid/code', { method: 'POST', body: JSON.stringify(payload) }),
  hybridOCR: (payload) => request('/hybrid/ocr', { method: 'POST', body: JSON.stringify(payload) }),
  hybridOCRAI: (payload) => request('/hybrid/ocr-ai', { method: 'POST', body: JSON.stringify(payload) }),
}
