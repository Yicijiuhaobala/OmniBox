import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Check, ClipboardCopy, ClipboardList, Eraser, ImageIcon,
  Search, ShieldCheck, Trash2, Type,
} from 'lucide-react'

const formatBytes = (value = 0) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (value) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(value))

const sourceLabels = {
  'clipboard-image': '复制图像',
  'local-image-file': '本地图片文件',
  'html-data-image': '网页内嵌图片',
  'web-url': '联网图片地址',
}

export default function ClipboardHistoryPage({ tool, goHome }) {
  const [entries, setEntries] = useState([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const copiedTimer = useRef(null)
  const Icon = tool.icon

  useEffect(() => {
    const history = window.desktop?.clipboardHistory
    if (!history) {
      setError('请在 OmniBox 桌面应用中使用超级剪贴板历史')
      setLoading(false)
      return undefined
    }

    let active = true
    history.list()
      .then((items) => { if (active) setEntries(items) })
      .catch((reason) => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    const unsubscribe = history.onChanged((items) => {
      if (active) setEntries(items)
    })
    return () => {
      active = false
      unsubscribe?.()
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (filter !== 'all' && entry.type !== filter) return false
      if (!keyword) return true
      return entry.type === 'text' && entry.preview.toLowerCase().includes(keyword)
    })
  }, [entries, filter, query])

  const copyEntry = async (id) => {
    setError('')
    try {
      const result = await window.desktop.clipboardHistory.copy(id)
      if (!result.ok) return setError(result.error || '复制失败')
      setCopiedId(id)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedId(''), 1400)
    } catch (reason) {
      setError(reason.message || '复制失败')
    }
  }

  const deleteEntry = async (id) => {
    setError('')
    try {
      const result = await window.desktop.clipboardHistory.delete(id)
      if (!result.ok) setError('这条剪贴板记录已不存在')
    } catch (reason) {
      setError(reason.message || '删除失败')
    }
  }

  const clearHistory = async () => {
    if (!entries.length || !window.confirm('确定清空全部剪贴板历史吗？此操作无法撤销。')) return
    setError('')
    try {
      await window.desktop.clipboardHistory.clear()
    } catch (reason) {
      setError(reason.message || '清空失败')
    }
  }

  return (
    <motion.div className="page-scroll tool-page clipboard-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
      <div className="tool-heading-row">
        <div className={`tool-icon large ${tool.color}`}><Icon size={26} /></div>
        <div><h1>{tool.title}</h1><p>{tool.description}</p></div>
      </div>

      <section className="clipboard-controls">
        <div className="clipboard-status"><span className="status-dot" /><div><strong>自动监听中</strong><small>已保存 {entries.length} / 50 条，仅在应用运行时记录</small></div></div>
        <label className="clipboard-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文本历史" /></label>
        <div className="clipboard-filters">
          {[['all', '全部'], ['text', '文本'], ['image', '图片']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <button className="clipboard-clear" onClick={clearHistory} disabled={!entries.length}><Eraser size={14} />清空</button>
      </section>

      <div className="tool-notice clipboard-privacy"><ShieldCheck size={15} /><span>历史内容只保存在当前电脑的 OmniBox 用户数据目录，不会发送到模型或网络服务。敏感内容使用后可随时删除或清空。</span></div>
      {error && <div className="error-message">{error}</div>}

      {loading ? <div className="clipboard-empty"><ClipboardList size={28} /><p>正在读取剪贴板历史…</p></div> : visibleEntries.length ? (
        <section className="clipboard-list">
          {visibleEntries.map((entry) => (
            <article className={`clipboard-entry ${entry.type}`} key={entry.id}>
              <header>
                <span className="clipboard-kind">{entry.type === 'text' ? <><Type size={13} />文本</> : <><ImageIcon size={13} />图片</>}</span>
                <time>{formatTime(entry.createdAt)}</time>
                <span className="clipboard-size">{entry.type === 'text' ? `${entry.characterCount.toLocaleString()} 字符` : `${entry.width} × ${entry.height}`} · {formatBytes(entry.byteSize)}</span>
                {sourceLabels[entry.source] && <span className="clipboard-source">{sourceLabels[entry.source]}</span>}
                <div className="clipboard-entry-actions">
                  <button onClick={() => copyEntry(entry.id)}>{copiedId === entry.id ? <Check size={14} /> : <ClipboardCopy size={14} />}{copiedId === entry.id ? '已复制' : '复制'}</button>
                  <button className="delete" title="删除这条记录" onClick={() => deleteEntry(entry.id)}><Trash2 size={14} /></button>
                </div>
              </header>
              {entry.type === 'text' ? <pre>{entry.preview}{entry.truncated ? '\n…（仅截断页面预览，复制时仍使用完整内容）' : ''}</pre> : <div className="clipboard-image"><img src={entry.thumbnail} alt={`${entry.width} × ${entry.height} 的剪贴板图片`} /></div>}
            </article>
          ))}
        </section>
      ) : (
        <div className="clipboard-empty"><ClipboardList size={30} /><h3>{entries.length ? '没有符合条件的记录' : '还没有剪贴板历史'}</h3><p>{entries.length ? '试试清除搜索条件或切换类型' : '复制一段文字或一张图片后，会自动出现在这里'}</p></div>
      )}
    </motion.div>
  )
}
