import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, CircleAlert, HardDrive, LoaderCircle, Play,
  ArchiveRestore, Copy, FileUp, FolderOpen, FolderSearch, PackageX, QrCode, RadioTower, RefreshCw,
  ServerOff, ShieldAlert, ShieldCheck, Smartphone, Trash2, X,
} from 'lucide-react'
import { api } from './api'
import './system-tools.css'


const formatBytes = (value = 0) => {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

function ToolHeading({ tool, goHome }) {
  const Icon = tool.icon
  return <>
    <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
    <div className="tool-heading-row">
      <div className={`tool-icon large ${tool.color}`}><Icon size={26} /></div>
      <div><h1>{tool.title}</h1><p>{tool.description}</p></div>
    </div>
  </>
}

function LoadingButton({ loading, onClick, children, className = 'primary-button', disabled = false }) {
  return <button className={className} onClick={onClick} disabled={loading || disabled}>
    {loading ? <><LoaderCircle className="spin" size={15} />处理中</> : children}
  </button>
}

function PortKiller({ tool, goHome }) {
  const [port, setPort] = useState('8000')
  const [inspection, setInspection] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const inspect = async () => {
    const numericPort = Number(port)
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      setError('端口必须是 1–65535 之间的整数')
      return
    }
    setLoading(true); setError(''); setMessage(''); setInspection(null)
    try { setInspection(await api.inspectPort({ port: numericPort })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const kill = async () => {
    if (!inspection?.inspection_id || !inspection.killable_count) return
    const names = inspection.processes.filter((item) => item.killable).map((item) => `${item.name} (PID ${item.pid})`).join('、')
    if (!window.confirm(`确定终止 ${names} 吗？\n\n进程中未保存的数据可能丢失。`)) return
    setLoading(true); setError(''); setMessage('')
    try {
      const result = await api.killPort({ port: Number(port), inspection_id: inspection.inspection_id, confirm: true })
      setInspection(result)
      setMessage(result.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return <motion.div className="page-scroll tool-page system-tool-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="system-tool-grid">
      <section className="workspace-card port-killer-form">
        <div className="system-card-title"><ServerOff size={18} /><div><strong>查询监听端口</strong><span>仅检查本机 TCP LISTEN 进程</span></div></div>
        <label className="control-label"><span>端口号</span><input type="number" min="1" max="65535" value={port} onChange={(event) => { setPort(event.target.value); setInspection(null); setMessage(''); setError('') }} onKeyDown={(event) => event.key === 'Enter' && inspect()} placeholder="例如：8000" /></label>
        <div className="tool-notice"><ShieldCheck size={15} /><span>查询完全在本机完成。OmniBox 后端及其父进程会被标记为受保护对象，无法从这里误杀。</span></div>
        <div className="run-row"><span>终止前会再次校验 PID 和进程签名</span><LoadingButton loading={loading} onClick={inspect}><Play size={15} />查询占用</LoadingButton></div>
      </section>

      <section className="output-card system-result-card">
        <div className="output-header"><span>端口状态</span>{inspection && <button onClick={inspect} disabled={loading}><RefreshCw size={13} />重新查询</button>}</div>
        {error && <div className="error-message">{error}</div>}
        {message && <div className="system-success"><CheckCircle2 size={15} />{message}</div>}
        {!inspection && !error ? <div className="system-empty"><ServerOff size={28} /><p>输入端口后查询占用进程</p></div> : inspection && <>
          <div className={`port-state-banner ${inspection.occupied ? 'occupied' : 'free'}`}>
            {inspection.occupied ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
            <div><strong>{inspection.occupied ? `端口 ${inspection.port} 正在使用` : `端口 ${inspection.port} 可用`}</strong><span>{inspection.result}</span></div>
          </div>
          {inspection.processes?.length > 0 && <div className="process-list">{inspection.processes.map((process) => <article key={process.pid} className={process.killable ? '' : 'protected'}>
            <div className="process-main"><strong>{process.name}</strong><code>PID {process.pid}</code>{process.killable ? <span className="killable-badge">可终止</span> : <span className="protected-badge">受保护</span>}</div>
            <p title={process.command}>{process.command || '无法读取启动命令'}</p>
            <small>{process.user}{process.protected_reason ? ` · ${process.protected_reason}` : ''}</small>
          </article>)}</div>}
          {inspection.killable_count > 0 && inspection.inspection_id && <div className="danger-action-row"><div><strong>终止占用进程</strong><span>将先发送正常退出信号，超时后强制结束。</span></div><LoadingButton className="danger-button" loading={loading} onClick={kill}><ServerOff size={15} />一键终止</LoadingButton></div>}
        </>}
      </section>
    </div>
  </motion.div>
}

const fileName = (path = '') => path.split(/[\\/]/).pop()

function LanTransfer({ tool, goHome }) {
  const [sharedFiles, setSharedFiles] = useState([])
  const [receiveDirectory, setReceiveDirectory] = useState('')
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = async () => {
    try {
      const data = await api.lanTransferStatus()
      setSession(data.active ? data : null)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { refreshStatus() }, [])
  useEffect(() => {
    if (!session?.active) return undefined
    const timer = window.setInterval(refreshStatus, 1_000)
    return () => window.clearInterval(timer)
  }, [session?.active])

  const chooseFiles = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中选择分享文件')
    const files = await window.desktop.selectFiles('any')
    setSharedFiles((current) => [...new Set([...current, ...files])].slice(0, 100))
    setError('')
  }

  const chooseReceiveDirectory = async () => {
    if (!window.desktop?.selectDirectory) return setError('请在 OmniBox 桌面应用中选择接收目录')
    const directory = await window.desktop.selectDirectory()
    if (directory) setReceiveDirectory(directory)
    setError('')
  }

  const start = async () => {
    setLoading(true); setError('')
    try {
      const data = await api.startLanTransfer({ shared_files: sharedFiles, receive_directory: receiveDirectory, expires_in_minutes: 10 })
      setSession(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stop = async () => {
    setLoading(true); setError('')
    try {
      await api.stopLanTransfer()
      setSession(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyUrl = () => {
    if (!session?.url) return
    if (window.desktop?.copyText) window.desktop.copyText(session.url)
    else navigator.clipboard?.writeText(session.url)
  }

  const secondsLeft = session ? Math.max(0, Math.floor(session.expires_at - Date.now() / 1000)) : 0
  const remaining = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`

  return <motion.div className="page-scroll tool-page system-tool-page lan-transfer-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="tool-notice lan-security-notice"><ShieldCheck size={15} /><span>只启动独立的临时文件服务，不会把 OmniBox 设置、API Key 或其他本地接口开放到局域网。</span></div>
    {error && <div className="error-message system-page-error">{error}</div>}
    {!session ? <div className="lan-setup-grid">
      <section className="workspace-card lan-setup-card">
        <div className="system-card-title"><FileUp size={18} /><div><strong>电脑分享给手机</strong><span>手机网页只会显示你在这里明确选择的文件</span></div></div>
        <button className="lan-picker" onClick={chooseFiles}><FileUp size={20} /><strong>{sharedFiles.length ? `已选择 ${sharedFiles.length} 个文件` : '选择要分享的文件'}</strong><span>最多 100 个文件，也可以只开启“手机上传到电脑”</span></button>
        {sharedFiles.length > 0 && <div className="lan-file-list">{sharedFiles.map((path) => <div key={path}><span><strong>{fileName(path)}</strong><small title={path}>{path}</small></span><button onClick={() => setSharedFiles(sharedFiles.filter((item) => item !== path))}><X size={13} /></button></div>)}</div>}
      </section>
      <section className="workspace-card lan-setup-card">
        <div className="system-card-title"><FolderOpen size={18} /><div><strong>手机上传到电脑</strong><span>上传文件保留原始字节，不压缩、不改画质</span></div></div>
        <button className="lan-directory" onClick={chooseReceiveDirectory}><FolderOpen size={18} /><span><small>接收目录</small><strong>{receiveDirectory || '下载/OmniBox 快传'}</strong></span></button>
        <div className="lan-session-options"><div><RadioTower size={15} /><span><strong>10 分钟临时会话</strong><small>关闭、退出应用或到期后立即停止监听</small></span></div></div>
      </section>
      <div className="lan-start-bar"><div><strong>准备启动局域网快传</strong><span>手机和电脑需要连接同一 Wi-Fi 或局域网</span></div><LoadingButton loading={loading} onClick={start}><QrCode size={15} />生成二维码</LoadingButton></div>
    </div> : <div className="lan-active-grid">
      <section className="workspace-card lan-qr-card">
        <div className="lan-live"><span />局域网服务运行中</div>
        <img src={session.qr_data_url} alt="局域网快传二维码" />
        <strong>手机扫码开始传输</strong>
        <p>同一局域网内直接连接这台电脑</p>
        <button className="lan-url" onClick={copyUrl}><code>{session.url}</code><Copy size={14} /></button>
      </section>
      <section className="workspace-card lan-session-card">
        <div className="lan-session-heading"><div><strong>本次快传</strong><span>剩余 {remaining}</span></div><LoadingButton className="danger-button" loading={loading} onClick={stop}><ServerOff size={14} />停止分享</LoadingButton></div>
        <div className="lan-stats"><div><strong>{session.connected_devices.length}</strong><span>已连接设备</span></div><div><strong>{session.uploaded_files.length}</strong><span>收到文件</span></div><div><strong>{session.download_count}</strong><span>下载次数</span></div></div>
        <div className="lan-session-section"><span>接收目录</span><strong title={session.receive_directory}>{session.receive_directory}</strong></div>
        <div className="lan-session-section"><span>电脑分享文件</span>{session.shared_files.length ? <div className="lan-shared-list">{session.shared_files.map((file) => <p key={file.id}><strong>{file.name}</strong><em>{formatBytes(file.size)}</em></p>)}</div> : <small>未选择文件，当前为仅接收模式</small>}</div>
        <div className="lan-session-section"><span>连接设备</span>{session.connected_devices.length ? <div className="lan-device-list">{session.connected_devices.map((device) => <p key={device.ip}><Smartphone size={13} /><strong>{device.ip}</strong><em>刚刚活跃</em></p>)}</div> : <small>等待手机扫码连接</small>}</div>
      </section>
    </div>}
  </motion.div>
}

function DiskSummary({ disk }) {
  if (!disk) return null
  const usedPercent = disk.total ? Math.round((disk.used / disk.total) * 100) : 0
  return <div className="disk-summary">
    <div className="disk-gauge" style={{ '--disk-used': `${usedPercent}%` }}><span>{usedPercent}%</span></div>
    <div><strong>设备存储空间</strong><p>已使用 {formatBytes(disk.used)}，剩余 {formatBytes(disk.free)}</p></div>
    <span className="disk-total">总计 {formatBytes(disk.total)}</span>
  </div>
}

function SpaceCleaner() {
  const [scan, setScan] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const runScan = async () => {
    setLoading(true); setError(''); setResult(null)
    try {
      const data = await api.scanStorage()
      setScan(data)
      setSelected(new Set(data.categories.filter((item) => item.recommended && item.file_count > 0).map((item) => item.id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = (categoryId) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const selectedCategories = scan?.categories.filter((item) => selected.has(item.id)) || []
  const selectedSize = selectedCategories.reduce((total, item) => total + item.size, 0)
  const selectedFileCount = selectedCategories.reduce((total, item) => total + item.file_count, 0)
  const selectedPersonalCount = selectedCategories
    .filter((item) => item.cleanup_mode === 'trash')
    .reduce((total, item) => total + item.file_count, 0)

  const clean = async () => {
    if (!scan || selectedCategories.length === 0) return
    const highRisk = selectedCategories.some((item) => item.risk === 'high')
    const warnings = []
    if (selectedPersonalCount) warnings.push(`${selectedPersonalCount.toLocaleString()} 个桌面、文档或下载目录大文件会移到系统废纸篓，清空废纸篓后才会真正释放空间。`)
    if (highRisk) warnings.push('你选择了清空废纸篓，其中的文件将永久删除且无法恢复。')
    const warning = warnings.length ? `\n\n${warnings.join('\n')}` : ''
    if (!window.confirm(`确定处理所选类别中的 ${selectedFileCount.toLocaleString()} 个文件，共 ${formatBytes(selectedSize)} 吗？${warning}`)) return
    setLoading(true); setError('')
    try {
      const data = await api.cleanStorage({ scan_id: scan.scan_id, categories: selectedCategories.map((item) => item.id), confirm: true })
      setResult(data)
      setScan(null)
      setSelected(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return <>
    <section className="workspace-card storage-overview">
      <div className="storage-overview-copy"><HardDrive size={20} /><div><strong>扫描缓存、日志和个人目录大文件</strong><span>同时检查桌面、文档和下载目录中不小于 100 MB 的文件。</span></div></div>
      <LoadingButton loading={loading} onClick={runScan}><RefreshCw size={15} />{scan ? '重新扫描' : '开始扫描'}</LoadingButton>
    </section>
    {(scan?.disk || result?.disk) && <DiskSummary disk={scan?.disk || result.disk} />}
    <div className="tool-notice warning storage-warning"><ShieldAlert size={15} /><span>个人目录大文件默认不勾选，处理后进入系统废纸篓；缓存、日志和废纸篓仍按页面标注清理。所有文件都会在处理前重新校验，扫描结果 10 分钟后自动失效。</span></div>
    {error && <div className="error-message system-page-error">{error}</div>}
    {result && <section className="output-card cleanup-result">
      <div className="cleanup-result-icon"><CheckCircle2 size={22} /></div>
      <div><strong>{result.trashed_files ? `处理完成，共处理 ${formatBytes(result.freed_bytes + result.trashed_bytes)}` : `清理完成，释放 ${formatBytes(result.freed_bytes)}`}</strong><p>永久删除 {result.deleted_files.toLocaleString()} 个文件，移到废纸篓 {(result.trashed_files || 0).toLocaleString()} 个文件，跳过 {result.skipped_files.toLocaleString()} 个已变化或不可访问的文件。</p></div>
      <button className="secondary-button" onClick={runScan}><RefreshCw size={14} />再次扫描</button>
    </section>}
    {scan && <>
      <div className="storage-category-list">{scan.categories.map((category) => <article key={category.id} className={`storage-category ${selected.has(category.id) ? 'selected' : ''} ${category.risk === 'high' ? 'high-risk' : ''} ${category.risk === 'personal' ? 'personal-risk' : ''}`}>
        <label>
          <input className="storage-checkmark" type="checkbox" checked={selected.has(category.id)} disabled={!category.available || category.file_count === 0} onChange={() => toggle(category.id)} />
          <div className="storage-category-copy"><div><strong>{category.title}</strong>{category.recommended && <span className="recommended-badge">建议清理</span>}{category.risk === 'high' && <span className="risk-badge">不可恢复</span>}{category.risk === 'personal' && <span className="personal-badge">移到废纸篓</span>}</div><p>{category.description}</p><code>{category.root}</code></div>
          <div className="storage-category-size"><strong>{formatBytes(category.size)}</strong><span>{category.file_count.toLocaleString()} 个文件{category.truncated ? '（已达扫描上限）' : ''}</span></div>
        </label>
        {category.samples?.length > 0 && <details><summary>查看最大的 {category.samples.length} 个候选文件</summary><div>{category.samples.map((sample) => <p key={sample.path}><code title={sample.path}>{sample.path}</code><span>{formatBytes(sample.size)}</span></p>)}</div></details>}
      </article>)}</div>
      <div className="storage-clean-bar"><div><strong>已选择 {selectedCategories.length} 类，共 {selectedFileCount.toLocaleString()} 个文件</strong><span>预计处理 {formatBytes(selectedSize)}{selectedPersonalCount ? '，个人大文件将移到废纸篓' : ''}</span></div><LoadingButton className="danger-button" loading={loading} disabled={selectedCategories.length === 0} onClick={clean}><Trash2 size={15} />处理所选项目</LoadingButton></div>
    </>}
    {!scan && !result && !error && <div className="system-empty storage-empty"><HardDrive size={30} /><p>开始扫描后选择需要清理的类别</p></div>}
  </>
}

function ResidualCleaner() {
  const [scan, setScan] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const runScan = async () => {
    setLoading(true); setError(''); setResult(null)
    try {
      const data = await api.scanAppResiduals()
      setScan(data)
      setSelected(new Set(data.groups.filter((item) => item.recommended && item.cleanable).map((item) => item.id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = (appId) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const selectedApps = scan?.groups.filter((item) => selected.has(item.id)) || []
  const selectedSize = selectedApps.reduce((total, item) => total + item.size, 0)

  const clean = async () => {
    if (!scan || selectedApps.length === 0) return
    const reviewCount = selectedApps.filter((item) => item.confidence !== 'high').length
    const reviewWarning = reviewCount ? `\n\n其中 ${reviewCount} 项只有单点或名称级证据，请确认它们确实属于已卸载应用。` : ''
    if (!window.confirm(`确定将所选 ${selectedApps.length} 组应用残余移到系统废纸篓吗？预计释放 ${formatBytes(selectedSize)}。${reviewWarning}`)) return
    setLoading(true); setError('')
    try {
      const data = await api.cleanAppResiduals({ scan_id: scan.scan_id, apps: selectedApps.map((item) => item.id), confirm: true })
      setResult(data)
      setScan(null)
      setSelected(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return <>
    <section className="workspace-card storage-overview">
      <div className="storage-overview-copy"><PackageX size={20} /><div><strong>扫描已卸载应用残余</strong><span>核对已安装应用清单，再检查标准配置、缓存、日志和容器目录。</span></div></div>
      <LoadingButton loading={loading} onClick={runScan}><FolderSearch size={15} />{scan ? '重新扫描' : '扫描应用残余'}</LoadingButton>
    </section>
    <div className="tool-notice residual-notice"><ArchiveRestore size={15} /><span>清理结果默认进入系统废纸篓，可以恢复。高置信项必须精确匹配应用标识并在多个标准位置出现；其余项目不会默认勾选。</span></div>
    {error && <div className="error-message system-page-error">{error}</div>}
    {result && <section className="output-card cleanup-result">
      <div className="cleanup-result-icon"><ArchiveRestore size={22} /></div>
      <div><strong>已移到废纸篓，预计释放 {formatBytes(result.freed_bytes)}</strong><p>移动 {result.moved_count.toLocaleString()} 个残余路径，跳过 {result.skipped_paths.length.toLocaleString()} 个已变化项目；需要时可从系统废纸篓恢复。</p></div>
      <button className="secondary-button" onClick={runScan}><RefreshCw size={14} />再次扫描</button>
    </section>}
    {scan && <>
      <div className="residual-scan-summary"><div><strong>{scan.groups.length}</strong><span>组可能残余</span></div><div><strong>{scan.installed_apps_count}</strong><span>个已注册应用标识已核对</span></div><div><strong>{formatBytes(scan.high_confidence_size)}</strong><span>高置信可回收</span></div></div>
      {scan.groups.length > 0 ? <div className="residual-app-list">{scan.groups.map((app) => <article key={app.id} className={`residual-app ${selected.has(app.id) ? 'selected' : ''}`}>
        <label>
          <input className="storage-checkmark" type="checkbox" checked={selected.has(app.id)} disabled={!app.cleanable} onChange={() => toggle(app.id)} />
          <div className="residual-app-copy"><div><strong>{app.name}</strong>{app.confidence === 'high' ? <span className="recommended-badge">高置信</span> : <span className="review-badge">需确认</span>}{!app.cleanable && <span className="risk-badge">仅查看</span>}</div><code>{app.id}</code><p>{app.reason}</p></div>
          <div className="storage-category-size"><strong>{formatBytes(app.size)}</strong><span>{app.file_count.toLocaleString()} 个文件 · {app.paths.length} 个路径</span></div>
        </label>
        <details><summary>查看残余路径与占用</summary><div>{app.paths.map((item) => <p key={`${item.category}-${item.path}`}><span>{item.category}</span><code title={item.path}>{item.path}</code><em>{formatBytes(item.size)}</em></p>)}</div></details>
      </article>)}</div> : <div className="system-empty storage-empty"><CheckCircle2 size={30} /><p>没有发现符合规则的应用残余</p></div>}
      {scan.groups.length > 0 && <div className="storage-clean-bar"><div><strong>已选择 {selectedApps.length} 组应用残余</strong><span>预计移入废纸篓 {formatBytes(selectedSize)}</span></div><LoadingButton className="danger-button" loading={loading} disabled={selectedApps.length === 0} onClick={clean}><ArchiveRestore size={15} />移到废纸篓</LoadingButton></div>}
    </>}
    {!scan && !result && !error && <div className="system-empty storage-empty"><PackageX size={30} /><p>扫描后按应用查看残余配置、缓存和日志</p></div>}
  </>
}

function StorageCleaner({ tool, goHome }) {
  const [mode, setMode] = useState('space')
  return <motion.div className="page-scroll tool-page system-tool-page storage-cleaner-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="action-tabs advanced-tabs storage-mode-tabs">
      <button className={mode === 'space' ? 'active' : ''} onClick={() => setMode('space')}><HardDrive size={14} />常规清理</button>
      <button className={mode === 'residuals' ? 'active' : ''} onClick={() => setMode('residuals')}><PackageX size={14} />应用残余</button>
    </div>
    {mode === 'space' ? <SpaceCleaner /> : <ResidualCleaner />}
  </motion.div>
}

export default function SystemToolPage(props) {
  if (props.tool.id === 'port_killer') return <PortKiller {...props} />
  if (props.tool.id === 'lan_transfer') return <LanTransfer {...props} />
  return <StorageCleaner {...props} />
}
