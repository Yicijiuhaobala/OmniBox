import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Beaker, CheckCircle2, ChevronRight, CircleAlert, Clock3, FileJson2, Play, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { api } from './api'
import { llmLabCatalog } from './llm-lab/catalog'
import { LAB_IDS, runLab, validateLabInput } from './llm-lab/runtime.mjs'

const DEFAULT_INPUTS = {
  [LAB_IDS.tokenizer]: {
    text: 'low lower',
    tokenizer_id: 'omb-grapheme-bpe-v1',
    normalization: 'NFC',
    show_merge_trace: true,
  },
  [LAB_IDS.attention]: {
    q: [[1, 0], [0, 1]],
    k: [[1, 0], [0, 1]],
    v: [[1, 2], [3, 4]],
    mask_type: 'none',
    custom_mask: null,
    precision: 'float64',
  },
  [LAB_IDS.rag]: {
    chunks: [
      { chunk_id: 'chunk-01', text: 'cat sat mat' },
      { chunk_id: 'chunk-02', text: 'cat ate fish' },
      { chunk_id: 'chunk-03', text: 'dog ate fish' },
    ],
    query: 'cat fish',
    retrieval: { engine: 'omb-bm25-v1', k1: 1.5, b: 0.75, top_k: 3, min_score: 0 },
  },
}

const DEFAULT_PREDICTIONS = {
  [LAB_IDS.tokenizer]: '我预测英文单词经过合并后，Token 数会少于字符数。',
  [LAB_IDS.attention]: '我预测 Causal Mask 会让第一行第二列的 Attention 权重变为 0。',
  [LAB_IDS.promptCompare]: '我预测结构化 Prompt 在固定 JSON Schema 检查中通过率更高。',
  [LAB_IDS.rag]: '我预测同时包含 cat 和 fish 的 Chunk 会排在第一名。',
  [LAB_IDS.toolCalling]: '我预测多余参数会在 Schema 校验阶段停止，不会进入工具执行。',
  [LAB_IDS.evalRunner]: '我预测执行错误和评分错误必须单独报告，不能从总样本中静默消失。',
}

const cloneDefaults = () => Object.fromEntries(Object.entries(DEFAULT_INPUTS).map(([key, value]) => [key, structuredClone(value)]))
const fixed = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
const submissionKey = () => globalThis.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
const formatRunTime = (value) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function MatrixEditor({ label, value, onChange }) {
  const update = (row, column, nextValue) => {
    const matrix = value.map((items) => [...items])
    matrix[row][column] = Number(nextValue)
    onChange(matrix)
  }
  return (
    <fieldset className="lab-matrix-editor">
      <legend>{label}</legend>
      <div style={{ '--matrix-columns': value[0]?.length || 1 }}>
        {value.flatMap((row, rowIndex) => row.map((cell, columnIndex) => (
          <input
            key={`${rowIndex}-${columnIndex}`}
            type="number"
            step="0.1"
            value={cell}
            aria-label={`${label} 第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
            onChange={(event) => update(rowIndex, columnIndex, event.target.value)}
          />
        )))}
      </div>
    </fieldset>
  )
}

function MatrixView({ label, value }) {
  if (!Array.isArray(value) || !value.length) return null
  return (
    <div className="lab-matrix-view">
      <span>{label}</span>
      <div style={{ '--matrix-columns': value[0].length }}>
        {value.flatMap((row, rowIndex) => row.map((cell, columnIndex) => (
          <code key={`${rowIndex}-${columnIndex}`}>{cell === null ? 'Mask' : fixed(cell)}</code>
        )))}
      </div>
    </div>
  )
}

function ContractStatus({ lab }) {
  const goldenCount = Array.isArray(lab.golden.cases) ? lab.golden.cases.length : 1
  return (
    <div className="lab-contract-status">
      <div><FileJson2 size={15} /><span><strong>Schema 已载入</strong><small>{lab.contract.$id.split('/').pop()}</small></span></div>
      <div><CheckCircle2 size={15} /><span><strong>{goldenCount} 个黄金用例</strong><small>{lab.golden.test_id || lab.golden.cases.map((item) => item.test_id).join('、')}</small></span></div>
    </div>
  )
}

function TokenizerInput({ input, onChange }) {
  return <>
    <label className="control-label"><span>教学 Tokenizer</span><select value={input.tokenizer_id} onChange={(event) => onChange({ ...input, tokenizer_id: event.target.value })}><option value="omb-grapheme-bpe-v1">教学 BPE</option><option value="omb-unicode-grapheme-v1">Unicode Grapheme</option></select></label>
    <label className="editor-block lab-editor"><div className="editor-label"><span>输入文本</span><span>{new TextEncoder().encode(input.text).length} UTF-8 字节</span></div><textarea value={input.text} onChange={(event) => onChange({ ...input, text: event.target.value })} spellCheck="false" /></label>
    <label className="check-control compact-check"><input type="checkbox" checked={input.show_merge_trace} onChange={(event) => onChange({ ...input, show_merge_trace: event.target.checked })} /><span><strong>记录合并步骤</strong><small>只影响教学 BPE Trace</small></span></label>
    <div className="lab-boundary-note"><CircleAlert size={15} /><span>教学 Tokenizer 不等同于 GPT、Qwen、DeepSeek 等模型的真实 Tokenizer，也不能用于账单估算。</span></div>
  </>
}

function AttentionInput({ input, onChange }) {
  return <>
    <div className="lab-matrix-inputs">
      <MatrixEditor label="Q" value={input.q} onChange={(q) => onChange({ ...input, q })} />
      <MatrixEditor label="K" value={input.k} onChange={(k) => onChange({ ...input, k })} />
      <MatrixEditor label="V" value={input.v} onChange={(v) => onChange({ ...input, v })} />
    </div>
    <label className="control-label"><span>Mask</span><select value={input.mask_type} onChange={(event) => onChange({ ...input, mask_type: event.target.value })}><option value="none">无 Mask</option><option value="causal">Causal Mask</option></select></label>
    <small className="lab-field-help">P0 使用单 Batch、单 Head、float64，矩阵边长限制为 1–8。</small>
  </>
}

function RagInput({ input, onChange }) {
  const chunkText = input.chunks.map((chunk) => `${chunk.chunk_id}: ${chunk.text}`).join('\n')
  const updateChunks = (value) => onChange({
    ...input,
    chunks: value.split('\n').filter((line) => line.trim()).map((line, index) => {
      const separator = line.indexOf(':')
      return separator > 0
        ? { chunk_id: line.slice(0, separator).trim(), text: line.slice(separator + 1).trim() }
        : { chunk_id: `chunk-${String(index + 1).padStart(2, '0')}`, text: line.trim() }
    }),
  })
  return <>
    <label className="editor-block lab-editor"><div className="editor-label"><span>Chunk（每行一个，可使用 ID: 正文）</span><span>{input.chunks.length} 个</span></div><textarea className="code-editor" value={chunkText} onChange={(event) => updateChunks(event.target.value)} spellCheck="false" /></label>
    <label className="control-label"><span>查询</span><input value={input.query} onChange={(event) => onChange({ ...input, query: event.target.value })} /></label>
    <div className="lab-inline-fields">
      <label className="control-label"><span>k1</span><input type="number" min="0.1" max="5" step="0.1" value={input.retrieval.k1} onChange={(event) => onChange({ ...input, retrieval: { ...input.retrieval, k1: Number(event.target.value) } })} /></label>
      <label className="control-label"><span>b</span><input type="number" min="0" max="1" step="0.05" value={input.retrieval.b} onChange={(event) => onChange({ ...input, retrieval: { ...input.retrieval, b: Number(event.target.value) } })} /></label>
      <label className="control-label"><span>Top K</span><input type="number" min="1" max="10" value={input.retrieval.top_k} onChange={(event) => onChange({ ...input, retrieval: { ...input.retrieval, top_k: Number(event.target.value) } })} /></label>
    </div>
  </>
}

function LabResult({ labId, result }) {
  const [rawOpen, setRawOpen] = useState(false)
  if (!result) return <div className="lab-result-empty"><Beaker size={22} /><strong>等待运行</strong><span>先写下预测，再进行运行前检查。</span></div>
  if (result.status === 'error') return <div className="lab-error-state"><CircleAlert size={18} /><div><strong>{result.error.code}</strong><p>{result.error.message}</p><small>建议：{result.error.retry_instruction}</small><small>停止条件：{result.error.stop_condition}</small></div></div>
  const data = result.data || {}
  return <>
    <div className={`lab-run-summary ${result.status}`}><CheckCircle2 size={16} /><div><strong>{result.summary}</strong>{result.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div></div>
    {labId === LAB_IDS.tokenizer && data.tokens && <div className="lab-token-results"><div className="token-strip">{data.tokens.map((token) => <span key={`${token.index}-${token.piece}`} title={`Token ID: ${token.token_id ?? '<unk>'}`}>{token.display_text || token.piece}<small>{token.token_id ?? '—'}</small></span>)}</div><div className="lab-metrics">{Object.entries(data.counts).map(([key, value]) => <div key={key}><strong>{value}</strong><span>{key.replace('_', ' ')}</span></div>)}</div>{data.merge_trace.length > 0 && <ol className="lab-trace-list">{data.merge_trace.map((step) => <li key={step.step}><code>{step.rule}</code><ChevronRight size={13} /><strong>{step.result}</strong></li>)}</ol>}</div>}
    {labId === LAB_IDS.attention && data.weights && <div className="lab-attention-results"><MatrixView label="QKᵀ" value={data.raw_scores} /><MatrixView label="缩放后" value={data.scaled_scores} /><MatrixView label="Mask 后" value={data.masked_scores} /><MatrixView label="Softmax 权重" value={data.weights} /><MatrixView label="输出" value={data.output} /></div>}
    {labId === LAB_IDS.rag && data.results && <div className="lab-rag-results"><div className="lab-query-terms">Query Terms：{data.query.terms.map((term) => <code key={term}>{term}</code>)}</div>{data.results.map((item) => <article key={item.chunk_id}><header><span>#{item.rank}</span><strong>{item.chunk_id}</strong><code>{fixed(item.score)}</code></header><p>{item.text}</p><div>{item.term_contributions.map((term) => <small key={term.term}>{term.term}：{fixed(term.score)}</small>)}</div></article>)}</div>}
    {!data.tokens && !data.weights && !data.results && <pre className="lab-plan-output">{JSON.stringify(data, null, 2)}</pre>}
    <button className="lab-raw-toggle" onClick={() => setRawOpen((value) => !value)}>{rawOpen ? '收起' : '查看'}原始结构化结果</button>
    {rawOpen && <pre className="lab-raw-output">{JSON.stringify(result, null, 2)}</pre>}
  </>
}

export default function LLMLabPage({ tool, goHome }) {
  const [activeId, setActiveId] = useState(LAB_IDS.tokenizer)
  const [inputs, setInputs] = useState(cloneDefaults)
  const [predictions, setPredictions] = useState(DEFAULT_PREDICTIONS)
  const [conclusion, setConclusion] = useState('')
  const [conclusionFeedback, setConclusionFeedback] = useState('')
  const [result, setResult] = useState(null)
  const [resultMode, setResultMode] = useState(null)
  const [currentSubmissionKey, setCurrentSubmissionKey] = useState(null)
  const [savedRun, setSavedRun] = useState(null)
  const [savedEvidence, setSavedEvidence] = useState(null)
  const [saving, setSaving] = useState('')
  const [persistenceMessage, setPersistenceMessage] = useState('')
  const [persistenceError, setPersistenceError] = useState('')
  const [history, setHistory] = useState([])
  const [historyState, setHistoryState] = useState('loading')
  const activeLab = useMemo(() => llmLabCatalog.find((lab) => lab.id === activeId), [activeId])
  const input = inputs[activeId]
  const prediction = predictions[activeId]
  const ToolIcon = tool.icon
  const conclusionPasses = conclusion.trim().length >= 20 && /token|字符|权重|softmax|mask|分数|term|召回|chunk|schema|执行|错误|样本|因为|所以/i.test(conclusion)

  const loadHistory = async () => {
    setHistoryState('loading')
    try {
      const response = await api.listLabRuns(activeId, 10)
      setHistory(response.data.runs)
      setHistoryState('ready')
    } catch (error) {
      setHistory([])
      setHistoryState(error.message)
    }
  }

  useEffect(() => {
    let active = true
    setHistoryState('loading')
    api.listLabRuns(activeId, 10)
      .then((response) => { if (active) { setHistory(response.data.runs); setHistoryState('ready') } })
      .catch((error) => { if (active) { setHistory([]); setHistoryState(error.message) } })
    return () => { active = false }
  }, [activeId])

  const switchLab = (labId) => {
    setActiveId(labId)
    setResult(null)
    setResultMode(null)
    setCurrentSubmissionKey(null)
    setSavedRun(null)
    setSavedEvidence(null)
    setConclusion('')
    setConclusionFeedback('')
    setPersistenceMessage('')
    setPersistenceError('')
  }
  const setInput = (value) => setInputs((current) => ({ ...current, [activeId]: value }))
  const setPrediction = (value) => setPredictions((current) => ({ ...current, [activeId]: value }))
  const preflight = () => {
    setResult(validateLabInput(activeId, input))
    setResultMode('preflight')
    setCurrentSubmissionKey(null)
    setSavedRun(null)
    setSavedEvidence(null)
    setPersistenceMessage('')
    setPersistenceError('')
  }
  const run = () => {
    setResult(runLab(activeId, input))
    setResultMode('run')
    setCurrentSubmissionKey(submissionKey())
    setSavedRun(null)
    setSavedEvidence(null)
    setPersistenceMessage('')
    setPersistenceError('')
  }
  const reset = () => {
    if (DEFAULT_INPUTS[activeId]) setInput(structuredClone(DEFAULT_INPUTS[activeId]))
    setResult(null)
    setResultMode(null)
    setCurrentSubmissionKey(null)
    setSavedRun(null)
    setSavedEvidence(null)
    setPersistenceMessage('')
    setPersistenceError('')
  }
  const checkConclusion = () => {
    setConclusionFeedback(conclusionPasses ? '结论检查通过：已经包含现象和解释。' : '结论还需要包含观察到的证据，以及你对原因的解释。')
  }
  const saveRun = async () => {
    if (resultMode !== 'run' || !result || !currentSubmissionKey) return
    setSaving('run'); setPersistenceError(''); setPersistenceMessage('')
    try {
      const response = await api.saveLabRun({
        submission_key: currentSubmissionKey,
        lab_ref: activeId,
        lab_version: '1.0.0',
        prediction,
        parameters: input,
        result,
      })
      setSavedRun(response.data.run)
      setPersistenceMessage(response.summary)
      await loadHistory()
    } catch (error) {
      setPersistenceError(`${error.code ? `${error.code}：` : ''}${error.message}${error.retryInstruction ? `；${error.retryInstruction}` : ''}`)
    } finally {
      setSaving('')
    }
  }
  const saveEvidence = async () => {
    if (!savedRun || !conclusionPasses) return
    setSaving('evidence'); setPersistenceError(''); setPersistenceMessage('')
    try {
      const response = await api.saveLabEvidence({ run_id: savedRun.id, conclusion: conclusion.trim() })
      setSavedEvidence(response.data.evidence)
      setPersistenceMessage(response.summary)
      await loadHistory()
    } catch (error) {
      setPersistenceError(`${error.code ? `${error.code}：` : ''}${error.message}${error.retryInstruction ? `；${error.retryInstruction}` : ''}`)
    } finally {
      setSaving('')
    }
  }

  return (
    <motion.div className="page-scroll tool-page llm-lab-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button className="back-link" onClick={goHome}><ArrowLeft size={15} /> 返回工具箱</button>
      <div className="tool-heading-row llm-lab-heading">
        <div className={`tool-icon large ${tool.color}`}><ToolIcon size={27} /></div>
        <div><div className="title-with-badge"><h1>{tool.title}</h1><span className="local-only-badge"><ShieldCheck size={11} />P0 本地实验</span></div><p>{tool.description}</p></div>
      </div>

      <nav className="lab-catalog" aria-label="大模型实验列表">
        {llmLabCatalog.map((lab) => { const Icon = lab.icon; return <button key={lab.id} className={activeId === lab.id ? 'active' : ''} onClick={() => switchLab(lab.id)}><Icon size={16} /><span><strong>{lab.shortTitle}</strong><small>{lab.executable ? '可运行' : '契约就绪'}</small></span></button> })}
      </nav>

      <section className="lab-titlebar">
        <div><span>{activeLab.mode} · 实验 v1.0.0</span><h2>{activeLab.title}</h2><p>{activeLab.description}</p></div>
        <ContractStatus lab={activeLab} />
      </section>

      <div className="lab-workspace">
        <section className="lab-column lab-input-column">
          <header><span>01</span><div><strong>预测与参数</strong><small>先预测，再运行</small></div></header>
          <label className="control-label"><span>我的预测</span><textarea className="lab-prediction" value={prediction} onChange={(event) => setPrediction(event.target.value)} placeholder="运行前写下你的判断…" /></label>
          {activeId === LAB_IDS.tokenizer && <TokenizerInput input={input} onChange={setInput} />}
          {activeId === LAB_IDS.attention && <AttentionInput input={input} onChange={setInput} />}
          {activeId === LAB_IDS.rag && <RagInput input={input} onChange={setInput} />}
          {!activeLab.executable && <div className="lab-pending"><FileJson2 size={20} /><strong>执行器尚未接入</strong><p>本轮仅交付 Schema 与黄金夹具，不会调用模型或模拟真实工具执行。</p></div>}
          <div className="lab-run-actions"><button className="secondary-button" onClick={reset} disabled={!activeLab.executable}><RotateCcw size={14} />恢复示例</button><button className="secondary-button" onClick={preflight}>运行前检查</button><button className="primary-button" onClick={run} disabled={!activeLab.executable || !prediction.trim()}><Play size={14} />运行实验</button></div>
        </section>

        <section className="lab-column lab-result-column">
          <header><span>02</span><div><strong>过程与结果</strong><small>检查中间步骤</small></div></header>
          <LabResult key={activeId} labId={activeId} result={result} />
          <div className="lab-save-run">
            <div><strong>{savedRun ? '运行已保存' : resultMode === 'preflight' ? '运行前检查不会落库' : '保存可复现运行'}</strong><small>{savedRun ? savedRun.id : '保存参数、预测、结构化结果和环境审计信息'}</small></div>
            <button className="secondary-button" onClick={saveRun} disabled={resultMode !== 'run' || !result || !!savedRun || !!saving}><Save size={14} />{saving === 'run' ? '保存中' : savedRun ? '已保存' : '保存运行'}</button>
          </div>
        </section>

        <section className="lab-column lab-conclusion-column">
          <header><span>03</span><div><strong>解释与结论</strong><small>用证据说明原因</small></div></header>
          <div className="lab-guiding-questions"><strong>结论提示</strong>{activeId === LAB_IDS.tokenizer && <p>字符数和 Token 数哪里不同？教学 Tokenizer 的边界是什么？</p>}{activeId === LAB_IDS.attention && <p>缩放发生在哪一步？Mask 为什么会让对应权重变为 0？</p>}{activeId === LAB_IDS.rag && <p>排名由哪些 term contribution 组成？失败会发生在哪个阶段？</p>}{!activeLab.executable && <p>Schema、执行器和模型候选输出之间应该怎样隔离？</p>}</div>
          <label className="control-label"><span>我的结论</span><textarea className="lab-conclusion" value={conclusion} onChange={(event) => { setConclusion(event.target.value); setConclusionFeedback('') }} placeholder="引用结果中的数字或中间步骤，再解释原因…" /></label>
          {conclusionFeedback && <div className={`lab-conclusion-feedback ${conclusionFeedback.includes('通过') ? 'success' : ''}`}>{conclusionFeedback}</div>}
          <button className="secondary-button lab-check-button" onClick={checkConclusion} disabled={!result || !conclusion.trim()}>检查结论</button>
          <button className="primary-button lab-evidence-button" onClick={saveEvidence} disabled={!savedRun || !conclusionPasses || !!savedEvidence || !!saving}><ShieldCheck size={14} />{saving === 'evidence' ? '保存中' : savedEvidence ? '证据已保存' : '保存学习证据'}</button>
          <div className="lab-evidence-note"><ShieldCheck size={15} /><span>证据以“候选”状态保存在本机 learning-user.db；后续复习或评测验证后才能成为有效能力证据。</span></div>
          {persistenceMessage && <div className="lab-persistence-message">{persistenceMessage}</div>}
          {persistenceError && <div className="lab-persistence-error">{persistenceError}</div>}
        </section>
      </div>

      <section className="lab-history">
        <header><div><Clock3 size={16} /><span><strong>最近运行</strong><small>仅显示当前实验最近 10 条本地记录</small></span></div><button className="secondary-button" onClick={loadHistory} disabled={historyState === 'loading'}><RefreshCw size={14} className={historyState === 'loading' ? 'spin' : ''} />刷新</button></header>
        {historyState === 'loading' ? <div className="lab-history-empty">正在读取本地学习库…</div> : historyState !== 'ready' ? <div className="lab-history-error"><CircleAlert size={15} />{historyState}</div> : history.length ? <div className="lab-history-list">{history.map((run) => <article key={run.id}><time>{formatRunTime(run.created_at)}</time><div><strong>{run.summary || run.status}</strong><small>{run.prediction}</small></div><span className={`lab-run-status ${run.status}`}>{run.status === 'succeeded' ? '运行成功' : '运行失败'}</span>{run.evidence ? <span className="lab-evidence-status">候选证据</span> : <span className="lab-evidence-status empty">未保存证据</span>}</article>)}</div> : <div className="lab-history-empty">当前实验还没有已保存的运行。</div>}
      </section>
    </motion.div>
  )
}
