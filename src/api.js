const API_BASE = window.desktop?.apiBase || import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api'

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
  if (!response.ok) {
    const detail = data.detail
    const message = typeof detail === 'object' && detail !== null ? detail.message : detail
    const error = new Error(message || `请求失败（${response.status}）`)
    if (typeof detail === 'object' && detail !== null) {
      error.code = detail.code
      error.retryable = detail.retryable
      error.rootCauseHint = detail.root_cause_hint
      error.retryInstruction = detail.retry_instruction
      error.stopCondition = detail.stop_condition
    }
    throw error
  }
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
  inspectPort: (payload) => request('/system/ports/inspect', { method: 'POST', body: JSON.stringify(payload) }),
  killPort: (payload) => request('/system/ports/kill', { method: 'POST', body: JSON.stringify(payload) }),
  scanStorage: () => request('/system/storage/scan', { method: 'POST' }),
  cleanStorage: (payload) => request('/system/storage/clean', { method: 'POST', body: JSON.stringify(payload) }),
  scanAppResiduals: () => request('/system/residuals/scan', { method: 'POST' }),
  cleanAppResiduals: (payload) => request('/system/residuals/clean', { method: 'POST', body: JSON.stringify(payload) }),
  lanTransferStatus: () => request('/lan-transfer/status'),
  startLanTransfer: (payload) => request('/lan-transfer/start', { method: 'POST', body: JSON.stringify(payload) }),
  stopLanTransfer: () => request('/lan-transfer/stop', { method: 'POST' }),
  officeFormula: (payload) => request('/office/formula', { method: 'POST', body: JSON.stringify(payload) }),
  officeProcess: (payload) => request('/office/process', { method: 'POST', body: JSON.stringify(payload) }),
  officePlans: () => request('/office/plans'),
  saveOfficePlan: (payload) => request('/office/plans', { method: 'POST', body: JSON.stringify(payload) }),
  deleteOfficePlan: (planId) => request(`/office/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' }),
  extractPresentation: (payload) => request('/presentations/extract', { method: 'POST', body: JSON.stringify(payload) }),
  inspectPresentation: (payload) => request('/presentations/inspect', { method: 'POST', body: JSON.stringify(payload) }),
  presentationTemplates: (refresh = false) => request(`/presentation-templates${refresh ? '?refresh=true' : ''}`),
  downloadPresentationTemplate: (templateId) => request(`/presentation-templates/${encodeURIComponent(templateId)}/download`, { method: 'POST' }),
  cachedPresentationTemplate: (templateId) => request(`/presentation-templates/${encodeURIComponent(templateId)}/cached`),
  deletePresentationTemplate: (templateId) => request(`/presentation-templates/${encodeURIComponent(templateId)}/cached`, { method: 'DELETE' }),
  markdownDocx: (payload) => request('/presentations/markdown-docx', { method: 'POST', body: JSON.stringify(payload) }),
  hybridTranslate: (payload) => request('/hybrid/translate', { method: 'POST', body: JSON.stringify(payload) }),
  hybridCode: (payload) => request('/hybrid/code', { method: 'POST', body: JSON.stringify(payload) }),
  hybridOCR: (payload) => request('/hybrid/ocr', { method: 'POST', body: JSON.stringify(payload) }),
  visionComponentStatus: (refresh = false) => request(`/hybrid/ocr-component${refresh ? '?refresh=true' : ''}`),
  installVisionComponent: () => request('/hybrid/ocr-component/install', { method: 'POST' }),
  removeVisionComponent: () => request('/hybrid/ocr-component', { method: 'DELETE' }),
  hybridOCRAI: (payload) => request('/hybrid/ocr-ai', { method: 'POST', body: JSON.stringify(payload) }),
  learningStatus: () => request('/learning/status'),
  saveLabRun: (payload) => request('/learning/lab-runs', { method: 'POST', body: JSON.stringify(payload) }),
  listLabRuns: (labRef, limit = 10) => request(`/learning/lab-runs?${new URLSearchParams({ lab_ref: labRef, limit: String(limit) })}`),
  getLabRun: (runId) => request(`/learning/lab-runs/${encodeURIComponent(runId)}`),
  saveLabEvidence: (payload) => request('/learning/evidence', { method: 'POST', body: JSON.stringify(payload) }),
  fundProgress: () => request('/learning/fund/progress'),
  fundLessonContent: (lessonRef, payload) => request(`/learning/fund/lessons/${encodeURIComponent(lessonRef)}/content`, { method: 'POST', body: JSON.stringify(payload) }),
  saveFundAttempt: (payload) => request('/learning/fund/attempts', { method: 'POST', body: JSON.stringify(payload) }),
}
