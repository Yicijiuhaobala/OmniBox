import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, HardDrive, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { api } from './api'

const formatBytes = (value) => {
  const bytes = Number(value) || 0
  if (!bytes) return '大小待获取'
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

export default function VisionComponentCard({ onReadyChange }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const pollTimer = useRef(null)

  const applyStatus = (next) => {
    setStatus(next)
    onReadyChange?.(Boolean(next?.installed))
  }
  const load = async (refresh = false) => {
    try { applyStatus(await api.visionComponentStatus(refresh)); setError('') }
    catch (err) { setError(err.message) }
  }
  useEffect(() => {
    load(true)
    return () => { if (pollTimer.current) clearInterval(pollTimer.current) }
  }, [])

  const install = async () => {
    setBusy('install'); setError('')
    pollTimer.current = setInterval(async () => {
      try { applyStatus(await api.visionComponentStatus()) } catch { /* 安装请求负责显示最终错误 */ }
    }, 500)
    try { applyStatus(await api.installVisionComponent()) }
    catch (err) { setError(err.message); await load() }
    finally {
      if (pollTimer.current) clearInterval(pollTimer.current)
      pollTimer.current = null
      setBusy('')
    }
  }
  const remove = async () => {
    if (!window.confirm('删除本地视觉组件？OCR 和图片选区修复下次使用时需要重新下载。')) return
    setBusy('remove'); setError('')
    try { applyStatus(await api.removeVisionComponent()) }
    catch (err) { setError(err.message) }
    finally { setBusy('') }
  }

  const downloading = busy === 'install' || ['downloading', 'verifying'].includes(status?.state)
  const total = Number(status?.total_bytes) || 0
  const downloaded = Number(status?.downloaded_bytes) || 0
  const progress = total ? Math.min(100, Math.round(downloaded / total * 100)) : 0
  return <section className={`vision-component-card ${status?.installed ? 'ready' : ''}`}>
    <div className="vision-component-icon">{status?.installed ? <CheckCircle2 size={19} /> : <HardDrive size={19} />}</div>
    <div className="vision-component-content">
      <strong>{status?.installed ? '本地视觉组件已就绪' : '首次使用需下载本地视觉组件'}</strong>
      <span>{status?.installed ? `版本 ${status.version} · OCR 与选区修复可完全离线使用` : `包含 RapidOCR、ONNX 与 OpenCV · ${formatBytes(total)} · 下载后不再联网`}</span>
      {downloading && <div className="vision-download-progress"><i style={{ width: `${progress}%` }} /><small>{status?.state === 'verifying' ? '正在校验并启动检查…' : total ? `正在下载 ${progress}%` : '正在连接下载源…'}</small></div>}
      {(error || status?.warning) && <small className="vision-component-error">{error || status.warning}</small>}
    </div>
    <div className="vision-component-actions">
      {status?.installed ? <>
        {!status.external && <button disabled={Boolean(busy)} onClick={remove}><Trash2 size={13} />删除组件</button>}
        {status.update_available && <button className="primary" disabled={Boolean(busy)} onClick={install}><RefreshCw size={13} />更新</button>}
      </> : <button className="primary" disabled={Boolean(busy) || !status?.catalog_available} onClick={install}>{downloading ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{downloading ? '安装中…' : '下载并启用'}</button>}
    </div>
  </section>
}
