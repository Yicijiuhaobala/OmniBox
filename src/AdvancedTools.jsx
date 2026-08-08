import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, Clipboard, Copy, Eye, FilePlus2, FolderOpen,
  LoaderCircle, Play, ShieldAlert, ShieldCheck, Trash2, Wifi, XCircle,
} from 'lucide-react'
import { api } from './api'


const fileName = (path) => path.split(/[\\/]/).pop()
const formatBytes = (value) => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1024) return `${value} B`
  if (Math.abs(value) < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function copyText(text) {
  if (window.desktop?.copyText) window.desktop.copyText(text)
  else navigator.clipboard.writeText(text)
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

function Tabs({ items, value, onChange }) {
  return <div className="action-tabs advanced-tabs">{items.map(([id, label]) => <button key={id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>{label}</button>)}</div>
}

function RunButton({ loading, onClick, label = '开始处理' }) {
  return <button className="primary-button" onClick={onClick} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} />处理中</> : <><Play size={15} />{label}</>}</button>
}

function ResultPanel({ result, error, children, empty = '运行后在这里查看结果' }) {
  const text = result?.result || ''
  return <section className={`output-card advanced-output ${result ? 'has-output' : ''}`}>
    <div className="output-header"><span>处理结果</span>{text && <button onClick={() => copyText(text)}><Clipboard size={14} />复制</button>}</div>
    {error && <div className="error-message">{error}</div>}
    {children || (text ? <pre>{text}</pre> : <div className="empty-output"><p>{empty}</p></div>)}
  </section>
}

function TreeNode({ node, depth = 0 }) {
  const hasChildren = node.children?.length
  if (!hasChildren) return <div className="tree-leaf" style={{ '--depth': depth }}><span>{node.name}</span><em>{node.type}</em><code>{node.value === null ? 'null' : String(node.value ?? '')}</code></div>
  return <details className="tree-node" open={depth < 2}>
    <summary style={{ '--depth': depth }}><strong>{node.name}</strong><em>{node.type}</em><small>{node.count} 项</small></summary>
    <div>{node.children.map((child, index) => <TreeNode node={child} depth={depth + 1} key={`${child.name}-${index}`} />)}</div>
  </details>
}

function StructuredTool({ tool, goHome }) {
  const [format, setFormat] = useState('json')
  const [action, setAction] = useState('format')
  const [input, setInput] = useState('{\n  "project": "OmniBox",\n  "features": ["files", "developer-tools"]\n}')
  const [schema, setSchema] = useState('{\n  "type": "object",\n  "required": ["project"]\n}')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.structured({ format, action, input, schema_text: schema })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="advanced-workspace">
      <section className="workspace-card advanced-editor-panel">
        <div className="advanced-toolbar"><Tabs items={[["json", "JSON"], ["yaml", "YAML"], ["xml", "XML"]]} value={format} onChange={setFormat} /><Tabs items={[["format", "格式化"], ["minify", "压缩"], ["validate", "语法检查"], ["tree", "节点树"], ["schema", "Schema 校验"]]} value={action} onChange={setAction} /></div>
        <label className="editor-block"><div className="editor-label"><span>输入内容</span><span>{input.length.toLocaleString()} 字符</span></div><textarea className="code-editor tall-editor" value={input} onChange={(event) => setInput(event.target.value)} spellCheck="false" /></label>
        {action === 'schema' && <label className="editor-block schema-editor"><div className="editor-label"><span>JSON Schema（Draft 2020-12）</span></div><textarea className="code-editor" value={schema} onChange={(event) => setSchema(event.target.value)} spellCheck="false" /></label>}
        <div className="run-row"><span>解析和校验完全在本机完成</span><RunButton loading={loading} onClick={run} /></div>
      </section>
      <ResultPanel result={result} error={error}>{result?.tree ? <div className="tree-view"><TreeNode node={result.tree} /></div> : result?.errors?.length ? <><div className="validation-state invalid"><XCircle size={15} />{result.result}</div><div className="validation-list">{result.errors.map((item, index) => <div key={index}><code>{item.path}</code><span>{item.message}</span></div>)}</div></> : result ? <><div className={`validation-state ${result.valid === false ? 'invalid' : ''}`}>{result.valid === false ? <XCircle size={15} /> : <CheckCircle2 size={15} />}{['validate', 'schema'].includes(action) ? result.result : '处理完成'}</div>{!['validate', 'schema'].includes(action) && <pre>{result.result}</pre>}</> : null}</ResultPanel>
    </div>
  </motion.div>
}

const codecActions = [
  ['base64_encode', 'Base64 编码'], ['base64_decode', 'Base64 解码'], ['url_encode', 'URL 编码'],
  ['url_decode', 'URL 解码'], ['jwt_decode', 'JWT 解码'], ['hash', '哈希计算'], ['hash_verify', '哈希校验'],
]

function CodecTool({ tool, goHome }) {
  const [action, setAction] = useState('base64_encode')
  const [input, setInput] = useState('OmniBox')
  const [algorithm, setAlgorithm] = useState('sha256')
  const [expected, setExpected] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.codec({ action, input, algorithm, expected })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="advanced-workspace">
      <section className="workspace-card advanced-editor-panel">
        <Tabs items={codecActions} value={action} onChange={setAction} />
        {(action === 'hash' || action === 'hash_verify') && <div className="inline-controls"><label className="control-label"><span>算法</span><select value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}><option value="md5">MD5</option><option value="sha256">SHA-256</option><option value="sha512">SHA-512</option></select></label>{action === 'hash_verify' && <label className="control-label grow"><span>预期摘要</span><input value={expected} onChange={(event) => setExpected(event.target.value)} placeholder="粘贴要比对的摘要" /></label>}</div>}
        {action === 'jwt_decode' && <div className="tool-notice warning"><ShieldAlert size={15} /><span>只解码 Header 和 Payload，不验证签名，不能据此判断令牌可信。</span></div>}
        <label className="editor-block"><div className="editor-label"><span>输入内容</span></div><textarea className="code-editor tall-editor" value={input} onChange={(event) => setInput(event.target.value)} spellCheck="false" /></label>
        <div className="run-row"><span>编码、解码与哈希均在本机执行</span><RunButton loading={loading} onClick={run} /></div>
      </section>
      <ResultPanel result={result} error={error}>{result ? <><div className={`validation-state ${result.valid === false ? 'invalid' : ''}`}>{result.warning || result.message || '处理完成'}</div><pre>{result.result}</pre></> : null}</ResultPanel>
    </div>
  </motion.div>
}

function TimeTool({ tool, goHome }) {
  const [action, setAction] = useState('timestamp_to_date')
  const [input, setInput] = useState(String(Math.floor(Date.now() / 1000)))
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const switchAction = (value) => {
    setAction(value); setResult(null)
    if (value === 'cron') setInput('0 9 * * 1-5')
    if (value === 'date_to_timestamp') setInput(new Date().toISOString().slice(0, 19))
    if (value === 'timestamp_to_date') setInput(String(Math.floor(Date.now() / 1000)))
  }
  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.time({ action, input, timezone })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="advanced-workspace compact-workspace">
      <section className="workspace-card advanced-form-panel">
        <Tabs items={[["timestamp_to_date", "时间戳 → 日期"], ["date_to_timestamp", "日期 → 时间戳"], ["cron", "Cron 预测"]]} value={action} onChange={switchAction} />
        <label className="control-label"><span>{action === 'cron' ? 'Cron 表达式' : action === 'date_to_timestamp' ? '日期时间' : 'Unix 时间戳（秒或毫秒）'}</span><input value={input} onChange={(event) => setInput(event.target.value)} /></label>
        <label className="control-label"><span>IANA 时区</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" /></label>
        <div className="run-row"><span>{action === 'cron' ? '支持标准 5 段和含秒 6 段表达式' : '自动识别秒与毫秒时间戳'}</span><RunButton loading={loading} onClick={run} /></div>
      </section>
      <ResultPanel result={result} error={error}>{result ? result.next ? <><div className="validation-state"><CheckCircle2 size={15} />{result.result}</div><ol className="future-list">{result.next.map((item, index) => <li key={item}><span>{index + 1}</span><code>{item}</code></li>)}</ol></> : <div className="timestamp-result"><strong>{result.result}</strong>{result.milliseconds && <span>毫秒：{result.milliseconds}</span>}<small>{result.timezone} · {result.unit || '本地日期时间'}</small></div> : null}</ResultPanel>
    </div>
  </motion.div>
}

function MatchPreview({ text, matches }) {
  const parts = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(<span key={`text-${index}`}>{text.slice(cursor, match.start)}</span>)
    parts.push(<mark key={`match-${index}`} title={`位置 ${match.start}–${match.end}`}>{match.text || '∅'}</mark>)
    cursor = Math.max(cursor, match.end)
  })
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>)
  return <div className="match-preview">{parts}</div>
}

function TextTool({ tool, goHome }) {
  const [action, setAction] = useState('dedupe')
  const [input, setInput] = useState('apple\nbanana\napple\norange')
  const [secondary, setSecondary] = useState('apple\nbanana\ngrape')
  const [pattern, setPattern] = useState('\\b[a-z]+\\b')
  const [flags, setFlags] = useState(['i'])
  const [descending, setDescending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const toggleFlag = (flag) => setFlags(flags.includes(flag) ? flags.filter((item) => item !== flag) : [...flags, flag])
  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.textLab({ action, input, secondary, pattern, flags, descending })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="advanced-workspace">
      <section className="workspace-card advanced-editor-panel">
        <Tabs items={[["dedupe", "按行去重"], ["sort", "行排序"], ["diff", "Diff 对比"], ["regex", "正则测试"]]} value={action} onChange={setAction} />
        {action === 'regex' && <div className="regex-bar"><input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="正则表达式" /><div>{[['i', '忽略大小写'], ['m', '多行'], ['s', '单行']].map(([flag, label]) => <label key={flag}><input type="checkbox" checked={flags.includes(flag)} onChange={() => toggleFlag(flag)} />{label}</label>)}</div></div>}
        {action === 'sort' && <label className="check-control compact-check"><input type="checkbox" checked={descending} onChange={(event) => setDescending(event.target.checked)} /><span><strong>降序排列</strong></span></label>}
        <div className={action === 'diff' ? 'split-editors' : ''}><label className="editor-block"><div className="editor-label"><span>{action === 'diff' ? '原始文本' : '输入文本'}</span></div><textarea className="code-editor tall-editor" value={input} onChange={(event) => setInput(event.target.value)} spellCheck="false" /></label>{action === 'diff' && <label className="editor-block"><div className="editor-label"><span>对比文本</span></div><textarea className="code-editor tall-editor" value={secondary} onChange={(event) => setSecondary(event.target.value)} spellCheck="false" /></label>}</div>
        <div className="run-row"><span>{action === 'regex' ? '执行超过 500ms 会自动中止' : '处理完全在本机完成'}</span><RunButton loading={loading} onClick={run} /></div>
      </section>
      <ResultPanel result={result} error={error}>{result ? action === 'regex' ? <><div className="validation-state">{result.result}{result.truncated && '（仅显示前 1000 个）'}</div><MatchPreview text={input} matches={result.matches || []} /><div className="match-list">{(result.matches || []).slice(0, 100).map((match, index) => <div key={index}><code>#{index + 1}</code><span>{match.start}–{match.end}</span><strong>{match.text || '空匹配'}</strong></div>)}</div></> : action === 'diff' ? <div className="diff-view">{result.result.split('\n').map((line, index) => <div className={line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : 'context'} key={index}>{line || ' '}</div>)}</div> : <pre>{result.result}</pre> : null}</ResultPanel>
    </div>
  </motion.div>
}

function ImageTool({ tool, goHome }) {
  const [files, setFiles] = useState([])
  const [imageInfo, setImageInfo] = useState({})
  const [outputDir, setOutputDir] = useState('')
  const [action, setAction] = useState('convert')
  const [target, setTarget] = useState('png')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [quality, setQuality] = useState(88)
  const [inpaintRadius, setInpaintRadius] = useState(5)
  const [pageSize, setPageSize] = useState('a4')
  const [margin, setMargin] = useState(48)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const chooseFiles = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中选择图片')
    const selected = await window.desktop.selectFiles('images')
    if (!selected.length) return
    const merged = [...new Set([...files, ...selected])]
    setFiles(merged); setError(''); setResult(null)
    try {
      const data = await api.imageInfo({ files: merged })
      const mapped = Object.fromEntries(data.items.map((item) => [item.path, item]))
      setImageInfo(mapped)
      const first = data.items[0]
      if (first && !width && !height) { setWidth(first.width); setHeight(first.height) }
    } catch (err) { setError(err.message) }
  }
  const removeFile = (path) => {
    setFiles(files.filter((item) => item !== path))
    setImageInfo((current) => { const next = { ...current }; delete next[path]; return next })
  }
  const switchAction = (value) => {
    setAction(value); setResult(null); setError('')
    const first = imageInfo[files[0]]
    if (first && ['resize', 'crop', 'inpaint'].includes(value)) {
      setX(0); setY(0); setWidth(first.width); setHeight(first.height)
    }
  }
  const chooseOutput = async () => {
    const selected = await window.desktop?.selectDirectory?.()
    if (selected) setOutputDir(selected)
  }
  const run = async () => {
    if (!files.length) return setError('请先选择图片')
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.image({ action, files, output_dir: outputDir, target, width: Number(width), height: Number(height), x: Number(x), y: Number(y), quality: Number(quality), inpaint_radius: Number(inpaintRadius), page_size: pageSize, margin: Number(margin) })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="file-workspace image-workspace">
      <section className="file-panel">
        <div className="panel-heading"><div><strong>1. 添加图片</strong><span>PNG、JPG、WebP、SVG</span></div><button className="secondary-button compact" onClick={chooseFiles}><FilePlus2 size={15} />选择图片</button></div>
        <div className={`file-dropzone ${files.length ? 'has-files' : ''}`} onClick={!files.length ? chooseFiles : undefined}>{files.length ? <div className="file-list">{files.map((path, index) => <div className="file-row" key={path}><span className="file-index">{index + 1}</span><div><strong>{fileName(path)}</strong><small>{imageInfo[path] ? `${imageInfo[path].width} × ${imageInfo[path].height} px · ${formatBytes(imageInfo[path].bytes)}` : '正在读取尺寸…'}</small><small className="file-path">{path}</small></div><button onClick={() => removeFile(path)}><Trash2 size={14} /></button></div>)}</div> : <><FilePlus2 size={25} /><strong>选择要处理的图片</strong><span>源图片不会被覆盖</span></>}</div>
        {!!files.length && <button className="text-button" onClick={chooseFiles}>+ 继续添加</button>}
      </section>
      <section className="file-panel settings-panel">
        <div className="panel-heading"><div><strong>2. 图片设置</strong><span>所有处理都在本机完成</span></div></div>
        <Tabs items={[["convert", "格式转换"], ["compress", "无损压缩"], ["resize", "尺寸缩放"], ["crop", "区域裁剪"], ["inpaint", "选区修复"], ["images_to_pdf", "照片转 PDF"], ["remove_exif", "清除 EXIF"]]} value={action} onChange={switchAction} />
        {action === 'convert' && <><div className="inline-controls"><label className="control-label"><span>目标格式</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option><option value="svg">SVG</option></select></label><label className="control-label grow"><span>JPG/WebP 质量：{quality}</span><input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(event.target.value)} /></label></div>{target === 'svg' && <div className="tool-notice"><ShieldAlert size={15} /><span>位图转 SVG 会以内嵌 PNG 方式封装，不会把像素自动矢量化。</span></div>}</>}
        {['resize', 'crop', 'inpaint'].includes(action) && <>{imageInfo[files[0]] && <div className="source-dimensions"><span>当前基准图片</span><strong>{imageInfo[files[0]].width} × {imageInfo[files[0]].height} px</strong><small>{files.length > 1 ? '批量处理会对每张图片使用相同参数' : fileName(files[0])}</small></div>}<div className="dimension-grid">{(action === 'crop' || action === 'inpaint') && <><label className="control-label"><span>起点 X</span><input type="number" min="0" value={x} onChange={(event) => setX(event.target.value)} /></label><label className="control-label"><span>起点 Y</span><input type="number" min="0" value={y} onChange={(event) => setY(event.target.value)} /></label></>}<label className="control-label"><span>{action === 'inpaint' ? '选区宽度' : '宽度'}{action === 'resize' && '（0=等比）'}</span><input type="number" min="0" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label className="control-label"><span>{action === 'inpaint' ? '选区高度' : '高度'}{action === 'resize' && '（0=等比）'}</span><input type="number" min="0" value={height} onChange={(event) => setHeight(event.target.value)} /></label>{action === 'inpaint' && <label className="control-label"><span>修复半径</span><input type="number" min="1" max="30" value={inpaintRadius} onChange={(event) => setInpaintRadius(event.target.value)} /></label>}</div></>}
        {action === 'inpaint' && <div className="tool-notice warning"><ShieldAlert size={15} /><span>仅用于处理本人拥有编辑权的图片。填写水印或瑕疵所在矩形坐标，本机会根据周边像素修复选区；复杂背景可能需要缩小选区并多次处理。</span></div>}
        {action === 'images_to_pdf' && <><div className="inline-controls"><label className="control-label"><span>页面尺寸</span><select value={pageSize} onChange={(event) => setPageSize(event.target.value)}><option value="a4">A4 自动横竖版</option><option value="original">跟随原图尺寸</option></select></label>{pageSize === 'a4' && <label className="control-label grow"><span>页边距：{margin} px</span><input type="range" min="0" max="200" value={margin} onChange={(event) => setMargin(event.target.value)} /></label>}</div><div className="tool-notice"><ShieldCheck size={15} /><span>按左侧顺序一张照片一页，保持原比例、不会裁切；输出 PDF 不携带原图 EXIF。</span></div></>}
        {action === 'compress' && <div className="tool-notice"><ShieldAlert size={15} /><span>PNG/WebP 使用无损重压缩；JPG 无损移除 EXIF 和注释，不重新编码图像数据。</span></div>}
        <div className="output-dir"><div><span>输出位置</span><strong>{outputDir || '自动创建“OmniBox 输出”文件夹'}</strong></div><button className="secondary-button compact" onClick={chooseOutput}>更改</button></div>
        {error && <div className="error-message">{error}</div>}
        <div className="file-run-row"><span>已选择 {files.length} 张</span><RunButton loading={loading} onClick={run} label={action === 'images_to_pdf' ? '合并为 PDF' : action === 'inpaint' ? '修复选区' : '开始处理'} /></div>
      </section>
    </div>
    <ResultPanel result={result} error="">{result ? <div className="image-results"><div className="validation-state"><CheckCircle2 size={15} />{result.result}</div>{result.items.map((item) => <div key={item.output}><div><strong>{fileName(item.output)}</strong><small>{item.note}</small></div><span>{formatBytes(item.before)} → {formatBytes(item.after)}</span></div>)}{result.failures.map((item) => <div className="failed" key={item.source}><div><strong>{fileName(item.source)}</strong><small>{item.error}</small></div></div>)}<button className="secondary-button compact" onClick={() => window.desktop?.showItemInFolder?.(result.items[0].output)}><FolderOpen size={14} />在文件夹中显示</button></div> : null}</ResultPanel>
  </motion.div>
}

function WatermarkTool({ tool, goHome }) {
  const [files, setFiles] = useState([])
  const [outputDir, setOutputDir] = useState('')
  const [text, setText] = useState('仅限业务办理使用，复印无效')
  const [opacity, setOpacity] = useState(24)
  const [angle, setAngle] = useState(-25)
  const [fontSize, setFontSize] = useState(0)
  const [spacing, setSpacing] = useState(48)
  const [color, setColor] = useState('#D94A4A')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const chooseFiles = async () => {
    if (!window.desktop?.selectFiles) return setError('请在 OmniBox 桌面应用中选择证件图片')
    const selected = await window.desktop.selectFiles('identity_images')
    if (selected.length) setFiles((current) => [...new Set([...current, ...selected])])
  }
  const chooseOutput = async () => {
    const selected = await window.desktop?.selectDirectory?.()
    if (selected) setOutputDir(selected)
  }
  const run = async () => {
    if (!files.length) return setError('请先选择证件图片')
    if (!text.trim()) return setError('请输入水印文字')
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.watermark({ files, text, output_dir: outputDir, opacity: Number(opacity), angle: Number(angle), font_size: Number(fontSize), spacing: Number(spacing), color })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <div className="file-workspace watermark-workspace">
      <section className="file-panel">
        <div className="panel-heading"><div><strong>1. 添加证件图片</strong><span>PNG、JPG、WebP · 可批量选择</span></div><button className="secondary-button compact" onClick={chooseFiles}><FilePlus2 size={15} />选择图片</button></div>
        <div className={`file-dropzone ${files.length ? 'has-files' : ''}`} onClick={!files.length ? chooseFiles : undefined}>{files.length ? <div className="file-list">{files.map((path, index) => <div className="file-row" key={path}><span className="file-index">{index + 1}</span><div><strong>{fileName(path)}</strong><small>{path}</small></div><button onClick={() => setFiles(files.filter((item) => item !== path))}><Trash2 size={14} /></button></div>)}</div> : <><ShieldCheck size={27} /><strong>选择身份证或营业执照照片</strong><span>图片只在当前电脑上处理</span></>}</div>
        <div className="tool-notice local-only-note"><ShieldCheck size={15} /><span>纯本地处理：不调用 AI、不访问网络、不覆盖源图片；输出文件会自动清除原图元数据。</span></div>
      </section>
      <section className="file-panel settings-panel watermark-settings">
        <div className="panel-heading"><div><strong>2. 设置防盗用水印</strong><span>重复铺满，避免局部裁剪后移除</span></div></div>
        <label className="control-label"><span>水印文字</span><input value={text} maxLength={120} onChange={(event) => setText(event.target.value)} /></label>
        <div className="watermark-preview" style={{ '--watermark-color': color, '--watermark-opacity': Number(opacity) / 100, '--watermark-angle': `${angle}deg` }}>{Array.from({ length: 8 }, (_, index) => <span key={index}>{text || '水印预览'}</span>)}</div>
        <div className="dimension-grid watermark-controls"><label className="control-label"><span>透明度：{opacity}%</span><input type="range" min="5" max="90" value={opacity} onChange={(event) => setOpacity(event.target.value)} /></label><label className="control-label"><span>角度：{angle}°</span><input type="range" min="-80" max="80" value={angle} onChange={(event) => setAngle(event.target.value)} /></label><label className="control-label"><span>字号（0=自动）</span><input type="number" min="0" max="300" value={fontSize} onChange={(event) => setFontSize(event.target.value)} /></label><label className="control-label"><span>间距</span><input type="number" min="0" max="500" value={spacing} onChange={(event) => setSpacing(event.target.value)} /></label></div>
        <label className="control-label color-input-row"><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <div className="output-dir"><div><span>输出位置</span><strong>{outputDir || '自动创建“OmniBox 输出”文件夹'}</strong></div><button className="secondary-button compact" onClick={chooseOutput}>更改</button></div>
        {error && <div className="error-message">{error}</div>}
        <div className="file-run-row"><span>已选择 {files.length} 张</span><RunButton loading={loading} onClick={run} label="添加水印" /></div>
      </section>
    </div>
    <ResultPanel result={result} error="">{result ? <div className="image-results"><div className="validation-state"><CheckCircle2 size={15} />{result.result}</div>{result.items.map((item) => <div key={item.output}><div><strong>{fileName(item.output)}</strong><small>{item.note}</small></div></div>)}{result.failures.map((item) => <div className="failed" key={item.source}><div><strong>{fileName(item.source)}</strong><small>{item.error}</small></div></div>)}<button className="secondary-button compact" onClick={() => window.desktop?.showItemInFolder?.(result.items[0].output)}><FolderOpen size={14} />在文件夹中显示</button></div> : null}</ResultPanel>
  </motion.div>
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) }
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > .5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    if (max === g) h = (b - r) / d + 2
    if (max === b) h = (r - g) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function ColorTool() {
  const [color, setColor] = useState('#4f82c3')
  const rgb = hexToRgb(color) || { r: 79, g: 130, b: 195 }
  const hsl = rgbToHsl(rgb)
  const pick = async () => {
    if (!window.EyeDropper) return
    const result = await new window.EyeDropper().open()
    setColor(result.sRGBHex)
  }
  return <div className="color-tool"><div className="color-preview" style={{ background: color }} /><div className="color-controls"><label><span>颜色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label className="grow"><span>HEX</span><input value={color} onChange={(event) => /^#[0-9a-f]{6}$/i.test(event.target.value) && setColor(event.target.value)} /></label>{window.EyeDropper && <button className="secondary-button" onClick={pick}><Eye size={15} />屏幕吸色</button>}</div><div className="color-values"><button onClick={() => copyText(color.toUpperCase())}><span>HEX</span><strong>{color.toUpperCase()}</strong><Copy size={13} /></button><button onClick={() => copyText(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)}><span>RGB</span><strong>{rgb.r}, {rgb.g}, {rgb.b}</strong><Copy size={13} /></button><button onClick={() => copyText(`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`)}><span>HSL</span><strong>{hsl.h}°, {hsl.s}%, {hsl.l}%</strong><Copy size={13} /></button></div></div>
}

function NetworkTool({ tool, goHome }) {
  const [action, setAction] = useState('ip')
  const [target, setTarget] = useState('')
  const [ports, setPorts] = useState('22,80,443,3000,5173,8000,8080')
  const [count, setCount] = useState(4)
  const [timeout, setTimeoutValue] = useState(.5)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.network({ action, target, ports, count: Number(count), timeout: Number(timeout) })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  return <motion.div className="page-scroll tool-page advanced-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <ToolHeading tool={tool} goHome={goHome} />
    <Tabs items={[["ip", "IP 归属地"], ["ping", "Ping"], ["ports", "端口扫描"], ["color", "颜色工具"]]} value={action} onChange={(value) => { setAction(value); setResult(null); setError('') }} />
    {action === 'color' ? <ColorTool /> : <div className="advanced-workspace compact-workspace">
      <section className="workspace-card advanced-form-panel network-form">
        <label className="control-label"><span>{action === 'ip' ? '公网 IP（留空查询当前出口 IP）' : 'IP 地址或主机名'}</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={action === 'ip' ? '例如：8.8.8.8' : '例如：example.com'} /></label>
        {action === 'ping' && <label className="control-label short-control"><span>发送次数</span><input type="number" min="1" max="5" value={count} onChange={(event) => setCount(event.target.value)} /></label>}
        {action === 'ports' && <><label className="control-label"><span>端口（逗号或范围，最多 100 个）</span><input value={ports} onChange={(event) => setPorts(event.target.value)} /></label><label className="control-label short-control"><span>单端口超时（秒）</span><input type="number" min="0.1" max="2" step="0.1" value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} /></label></>}
        {action === 'ip' && <div className="tool-notice warning"><Wifi size={15} /><span>此功能会向 ipwho.is 发送待查询 IP；免费接口每天最多 1000 次请求。</span></div>}
        <div className="run-row"><span>{action === 'ports' ? '仅进行 TCP Connect 扫描' : action === 'ping' ? '调用系统 Ping 命令' : '需要联网'}</span><RunButton loading={loading} onClick={run} label={action === 'ports' ? '开始扫描' : '执行'} /></div>
      </section>
      <ResultPanel result={result} error={error}>{result ? result.info ? <div className="info-grid">{Object.entries(result.info).filter(([, value]) => value !== null && value !== '').map(([key, value]) => <div key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}</div> : result.open ? <><div className="validation-state">{result.result} · {result.resolved_ip}</div><div className="port-results">{result.open.length ? result.open.map((item) => <div key={item.port}><strong>{item.port}</strong><span>{item.service || '未知服务'}</span><em>OPEN</em></div>) : <p>未发现开放端口</p>}</div></> : <pre>{result.result}</pre> : null}</ResultPanel>
    </div>}
  </motion.div>
}

export default function AdvancedToolPage({ tool, goHome }) {
  if (tool.id === 'structured') return <StructuredTool tool={tool} goHome={goHome} />
  if (tool.id === 'codec') return <CodecTool tool={tool} goHome={goHome} />
  if (tool.id === 'time_cron') return <TimeTool tool={tool} goHome={goHome} />
  if (tool.id === 'text_regex') return <TextTool tool={tool} goHome={goHome} />
  if (tool.id === 'image_local') return <ImageTool tool={tool} goHome={goHome} />
  if (tool.id === 'identity_watermark') return <WatermarkTool tool={tool} goHome={goHome} />
  return <NetworkTool tool={tool} goHome={goHome} />
}
