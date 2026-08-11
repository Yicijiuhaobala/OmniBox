export const LAB_IDS = {
  tokenizer: 'lab.llm.tokenizer_visualizer',
  attention: 'lab.llm.attention_toy',
  promptCompare: 'lab.llm.prompt_compare',
  rag: 'lab.llm.rag_debugger',
  toolCalling: 'lab.llm.tool_calling',
  evalRunner: 'lab.llm.eval_runner',
}

const IMPLEMENTED_LABS = new Set([LAB_IDS.tokenizer, LAB_IDS.attention, LAB_IDS.rag])
const encoder = new TextEncoder()
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' })

const auditFor = (labRef) => ({
  contract_version: 'llm-lab-p0-1',
  lab_ref: labRef,
  lab_version: '1.0.0',
  implementation: 'omnibox-web-p0-spike-1',
  policy_version: 'llm-lab-policy-1',
})

const success = (labRef, summary, data, metrics = {}, warnings = [], nextActions = []) => ({
  status: warnings.length ? 'warning' : 'success',
  summary,
  next_actions: nextActions,
  artifacts: [],
  data,
  metrics,
  warnings,
  error: null,
  audit: auditFor(labRef),
})

const failure = (labRef, code, message, options = {}) => ({
  status: 'error',
  summary: message,
  next_actions: options.nextActions || [],
  artifacts: [],
  data: null,
  metrics: {},
  warnings: [],
  error: {
    code,
    message,
    retryable: options.retryable ?? true,
    root_cause_hint: options.rootCause || message,
    retry_instruction: options.retryInstruction || '修正输入后重新运行。',
    stop_condition: options.stopCondition || '相同错误连续出现两次时停止重试并检查实验说明。',
  },
  audit: auditFor(labRef),
})

const utf8Length = (value) => encoder.encode(value).length
const hasLoneSurrogate = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

const graphemes = (value) => [...graphemeSegmenter.segment(value)]
const utf8Offset = (value, utf16Offset) => utf8Length(value.slice(0, utf16Offset))
const graphemeOffset = (segments, utf16Offset) => segments.filter((item) => item.index < utf16Offset).length

const BPE_MERGES = [
  ['l', 'o'],
  ['lo', 'w'],
  ['low', '</w>'],
  ['e', 'r'],
  ['er', '</w>'],
]

const BPE_VOCAB = new Map([
  ['low</w>', 100],
  ['low', 101],
  ['er</w>', 102],
])

function validateTokenizerInput(input) {
  if (!input || typeof input !== 'object') return ['SCHEMA_VALIDATION_FAILED', 'Tokenizer 输入必须是对象']
  if (typeof input.text !== 'string' || !input.text.length) return ['EMPTY_INPUT', '请输入需要分词的文本']
  if (hasLoneSurrogate(input.text)) return ['INVALID_UNICODE', '文本包含孤立 surrogate，无法安全归一化']
  if (utf8Length(input.text) > 10000) return ['INPUT_TOO_LARGE', '文本不能超过 10,000 UTF-8 字节']
  if (!['omb-unicode-grapheme-v1', 'omb-grapheme-bpe-v1'].includes(input.tokenizer_id)) return ['UNKNOWN_TOKENIZER', '请选择内置教学 Tokenizer']
  if (input.normalization !== 'NFC') return ['SCHEMA_VALIDATION_FAILED', 'P0 仅允许 NFC 归一化']
  return null
}

export function runTokenizer(input) {
  const validation = validateTokenizerInput(input)
  if (validation) return failure(LAB_IDS.tokenizer, ...validation)
  const normalized = input.text.normalize('NFC')
  if (utf8Length(normalized) > 10000) return failure(LAB_IDS.tokenizer, 'INPUT_TOO_LARGE', '归一化后的文本超过 10,000 UTF-8 字节')
  const allGraphemes = graphemes(normalized)
  let tokens = []
  const mergeTrace = []

  if (input.tokenizer_id === 'omb-unicode-grapheme-v1') {
    tokens = allGraphemes.map((item, index) => ({
      index,
      piece: item.segment,
      display_text: item.segment,
      token_id: null,
      utf8_start: utf8Offset(normalized, item.index),
      utf8_end: utf8Offset(normalized, item.index + item.segment.length),
      grapheme_start: index,
      grapheme_end: index + 1,
    }))
  } else {
    for (const match of normalized.matchAll(/\S+/gu)) {
      const word = match[0]
      const wordStart = match.index
      let symbols = graphemes(word).map((item) => ({
        piece: item.segment,
        start: wordStart + item.index,
        end: wordStart + item.index + item.segment.length,
      }))
      symbols.push({ piece: '</w>', start: wordStart + word.length, end: wordStart + word.length })

      for (const [left, right] of BPE_MERGES) {
        const next = []
        for (let index = 0; index < symbols.length; index += 1) {
          const current = symbols[index]
          const following = symbols[index + 1]
          if (following && current.piece === left && following.piece === right) {
            const merged = { piece: `${left}${right}`, start: current.start, end: following.end }
            if (input.show_merge_trace) {
              mergeTrace.push({
                step: mergeTrace.length + 1,
                rule: `${left} + ${right}`,
                result: merged.piece,
                utf8_start: utf8Offset(normalized, merged.start),
                utf8_end: utf8Offset(normalized, merged.end),
              })
            }
            next.push(merged)
            index += 1
          } else next.push(current)
        }
        symbols = next
      }

      for (const symbol of symbols) {
        const displayText = normalized.slice(symbol.start, symbol.end)
        tokens.push({
          index: tokens.length,
          piece: symbol.piece,
          display_text: displayText,
          token_id: BPE_VOCAB.get(symbol.piece) ?? null,
          utf8_start: utf8Offset(normalized, symbol.start),
          utf8_end: utf8Offset(normalized, symbol.end),
          grapheme_start: graphemeOffset(allGraphemes, symbol.start),
          grapheme_end: graphemeOffset(allGraphemes, symbol.end),
        })
      }
    }
  }

  if (tokens.length > 4096) return failure(LAB_IDS.tokenizer, 'OUTPUT_LIMIT_EXCEEDED', '分词结果超过 4,096 个 Token')
  const data = {
    normalized_text: normalized,
    normalization_changed: normalized !== input.text,
    tokenizer: {
      id: input.tokenizer_id,
      version: '1.0.0',
      vocab_sha256: 'teaching-vocab-omb-bpe-v1',
      merges_sha256: 'teaching-merges-omb-bpe-v1',
      unicode_version: 'runtime-icu',
    },
    tokens,
    merge_trace: mergeTrace,
    counts: {
      utf8_bytes: utf8Length(normalized),
      code_points: [...normalized].length,
      graphemes: allGraphemes.length,
      tokens: tokens.length,
    },
  }
  const warnings = input.tokenizer_id === 'omb-grapheme-bpe-v1'
    ? ['这是 OmniBox 教学 BPE，不代表任何商业模型的真实 Token 数或费用。']
    : []
  return success(LAB_IDS.tokenizer, `已生成 ${tokens.length} 个教学 Token`, data, data.counts, warnings, ['检查至少一个字符数与 Token 数不同的例子。'])
}

function matrixShape(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 1 || matrix.length > 8) return null
  const width = Array.isArray(matrix[0]) ? matrix[0].length : 0
  if (width < 1 || width > 8 || matrix.some((row) => !Array.isArray(row) || row.length !== width)) return null
  if (matrix.some((row) => row.some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10000))) return null
  return [matrix.length, width]
}

function validateAttentionInput(input) {
  const qShape = matrixShape(input?.q)
  const kShape = matrixShape(input?.k)
  const vShape = matrixShape(input?.v)
  if (!qShape || !kShape || !vShape) return ['INVALID_MATRIX', 'Q、K、V 必须是 1–8 维的有限数矩阵，且每行等长']
  if (qShape[1] !== kShape[1]) return ['SHAPE_MISMATCH', `Q 的 Dk=${qShape[1]}，但 K 的 Dk=${kShape[1]}`]
  if (kShape[0] !== vShape[0]) return ['SHAPE_MISMATCH', `K 的 Tk=${kShape[0]}，但 V 的行数=${vShape[0]}`]
  if (!['none', 'causal', 'custom'].includes(input.mask_type)) return ['SCHEMA_VALIDATION_FAILED', 'Mask 类型必须为 none、causal 或 custom']
  if (input.mask_type === 'causal' && qShape[0] !== kShape[0]) return ['SHAPE_MISMATCH', 'Causal Mask 要求 Tq 与 Tk 相等']
  if (input.mask_type === 'custom') {
    const mask = input.custom_mask
    if (!Array.isArray(mask) || mask.length !== qShape[0] || mask.some((row) => !Array.isArray(row) || row.length !== kShape[0] || row.some((value) => value !== 0 && value !== 1))) {
      return ['INVALID_MASK', `自定义 Mask 必须为 [${qShape[0]}, ${kShape[0]}] 的 0/1 矩阵`]
    }
    if (mask.some((row) => row.every((value) => value === 0))) return ['FULLY_MASKED_ROW', '自定义 Mask 至少有一行全部被屏蔽']
  }
  if (input.precision !== 'float64') return ['SCHEMA_VALIDATION_FAILED', 'P0 仅使用 float64 计算']
  return null
}

const multiply = (left, right) => left.map((row) => right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)))
const transpose = (matrix) => matrix[0].map((_, column) => matrix.map((row) => row[column]))

export function runAttention(input) {
  const validation = validateAttentionInput(input)
  if (validation) return failure(LAB_IDS.attention, ...validation)
  const [tq, dk] = matrixShape(input.q)
  const [tk, dv] = matrixShape(input.v)
  const rawScores = multiply(input.q, transpose(input.k))
  const scale = 1 / Math.sqrt(dk)
  const scaledScores = rawScores.map((row) => row.map((value) => value * scale))
  const allowed = scaledScores.map((row, queryIndex) => row.map((_, keyIndex) => {
    if (input.mask_type === 'causal') return keyIndex <= queryIndex
    if (input.mask_type === 'custom') return input.custom_mask[queryIndex][keyIndex] === 1
    return true
  }))
  const maskedScores = scaledScores.map((row, rowIndex) => row.map((value, columnIndex) => allowed[rowIndex][columnIndex] ? value : null))
  const weights = scaledScores.map((row, rowIndex) => {
    const visible = row.filter((_, columnIndex) => allowed[rowIndex][columnIndex])
    const maximum = Math.max(...visible)
    const exponentials = row.map((value, columnIndex) => allowed[rowIndex][columnIndex] ? Math.exp(value - maximum) : 0)
    const denominator = exponentials.reduce((sum, value) => sum + value, 0)
    return exponentials.map((value) => value / denominator)
  })
  const output = multiply(weights, input.v)
  const data = {
    shapes: { q: [tq, dk], k: matrixShape(input.k), v: [tk, dv], scores: [tq, tk], weights: [tq, tk], output: [tq, dv] },
    scale,
    raw_scores: rawScores,
    scaled_scores: scaledScores,
    masked_scores: maskedScores,
    weights,
    output,
    invariants: {
      weight_rows_sum_to_one: weights.every((row) => Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) <= 1e-12),
      masked_weights_are_zero: weights.every((row, rowIndex) => row.every((value, columnIndex) => allowed[rowIndex][columnIndex] || value === 0)),
      finite_output: output.flat().every(Number.isFinite),
    },
  }
  return success(LAB_IDS.attention, `已计算 ${tq}×${tk} Attention 权重`, data, { tq, tk, dk, dv }, [], ['依次检查原始分数、缩放、Mask、Softmax 和输出矩阵。'])
}

function isHan(value) {
  return /^\p{Script=Han}+$/u.test(value)
}

export function retrievalTerms(value) {
  const normalized = value.normalize('NFC').toLocaleLowerCase('und')
  const terms = []
  for (const item of wordSegmenter.segment(normalized)) {
    if (!item.isWordLike) continue
    if (isHan(item.segment)) {
      const units = [...item.segment]
      if (units.length === 1) terms.push(units[0])
      else for (let index = 0; index < units.length - 1; index += 1) terms.push(`${units[index]}${units[index + 1]}`)
    } else terms.push(item.segment)
  }
  return terms
}

function validateRagInput(input) {
  if (!input || typeof input !== 'object') return ['SCHEMA_VALIDATION_FAILED', 'RAG 输入必须是对象']
  if (!Array.isArray(input.chunks) || input.chunks.length < 1 || input.chunks.length > 500) return ['INVALID_CHUNKS', 'Chunk 数必须在 1–500 之间']
  const ids = new Set()
  for (const chunk of input.chunks) {
    if (!chunk || typeof chunk.chunk_id !== 'string' || !chunk.chunk_id.length || typeof chunk.text !== 'string' || !chunk.text.trim()) return ['INVALID_CHUNKS', '每个 Chunk 都需要非空 chunk_id 和 text']
    if (ids.has(chunk.chunk_id)) return ['DUPLICATE_CHUNK_ID', `Chunk ID 重复：${chunk.chunk_id}`]
    ids.add(chunk.chunk_id)
  }
  if (typeof input.query !== 'string' || !input.query.trim()) return ['EMPTY_QUERY_TERMS', '请输入检索问题']
  if (utf8Length(input.query) > 8000) return ['INPUT_TOO_LARGE', '检索问题不能超过 8 KB']
  const retrieval = input.retrieval
  if (!retrieval || retrieval.engine !== 'omb-bm25-v1') return ['UNKNOWN_RETRIEVAL_ENGINE', 'P0 仅允许 omb-bm25-v1']
  if (!(retrieval.k1 > 0 && retrieval.k1 <= 5) || !(retrieval.b >= 0 && retrieval.b <= 1)) return ['INVALID_RETRIEVAL_CONFIG', 'k1 必须在 (0,5]，b 必须在 [0,1]']
  if (!Number.isInteger(retrieval.top_k) || retrieval.top_k < 1 || retrieval.top_k > 10) return ['INVALID_RETRIEVAL_CONFIG', 'top_k 必须是 1–10 的整数']
  if (!(retrieval.min_score >= 0)) return ['INVALID_RETRIEVAL_CONFIG', 'min_score 不能小于 0']
  return null
}

export function runRag(input) {
  const validation = validateRagInput(input)
  if (validation) return failure(LAB_IDS.rag, ...validation)
  const queryTerms = [...new Set(retrievalTerms(input.query))]
  if (!queryTerms.length) return failure(LAB_IDS.rag, 'EMPTY_QUERY_TERMS', '查询中没有可检索的有效 term')
  const indexed = input.chunks.map((chunk, sourceIndex) => ({ ...chunk, sourceIndex, terms: retrievalTerms(chunk.text) }))
  const avgdl = indexed.reduce((sum, chunk) => sum + chunk.terms.length, 0) / indexed.length
  if (!avgdl) return failure(LAB_IDS.rag, 'EMPTY_INDEX', '所有 Chunk 都没有可检索的有效 term')
  const documentFrequency = new Map(queryTerms.map((term) => [term, indexed.filter((chunk) => chunk.terms.includes(term)).length]))
  const { k1, b, top_k: topK, min_score: minScore } = input.retrieval
  const results = indexed.map((chunk) => {
    const contributions = []
    for (const term of queryTerms) {
      const tf = chunk.terms.filter((item) => item === term).length
      if (!tf) continue
      const df = documentFrequency.get(term)
      const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5))
      const score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunk.terms.length / avgdl))
      contributions.push({ term, tf, df, idf, score })
    }
    return {
      chunk_id: chunk.chunk_id,
      source_index: chunk.sourceIndex,
      score: contributions.reduce((sum, item) => sum + item.score, 0),
      term_contributions: contributions,
      text: chunk.text,
    }
  }).filter((item) => item.term_contributions.length && item.score >= minScore)
    .sort((left, right) => right.score - left.score || left.source_index - right.source_index || left.chunk_id.localeCompare(right.chunk_id))
    .slice(0, topK)
    .map((item, index) => ({ ...item, rank: index + 1 }))

  const data = {
    index: { engine: 'omb-bm25-v1', documents: indexed.length, avgdl, tokenizer: 'omb-word-bigram-v1' },
    query: { original: input.query, terms: queryTerms },
    results,
  }
  return success(LAB_IDS.rag, `从 ${indexed.length} 个 Chunk 中召回 ${results.length} 个结果`, data, { documents: indexed.length, result_count: results.length, avgdl }, [], ['检查每个结果的 term contribution，并判断失败发生在哪个 RAG 阶段。'])
}

export function validateLabInput(labId, input) {
  if (!IMPLEMENTED_LABS.has(labId)) {
    return success(labId, '契约与黄金夹具已就绪，执行器将在后续 Spike 接入', { executable: false }, {}, ['当前页面不会调用模型或执行工具。'])
  }
  let validation
  if (labId === LAB_IDS.tokenizer) validation = validateTokenizerInput(input)
  if (labId === LAB_IDS.attention) validation = validateAttentionInput(input)
  if (labId === LAB_IDS.rag) validation = validateRagInput(input)
  if (validation) return failure(labId, ...validation)
  return success(labId, '运行前检查通过', { executable: true, network: false, model_calls: 0 }, {}, [], ['可以运行实验。'])
}

export function runLab(labId, input) {
  if (labId === LAB_IDS.tokenizer) return runTokenizer(input)
  if (labId === LAB_IDS.attention) return runAttention(input)
  if (labId === LAB_IDS.rag) return runRag(input)
  return failure(labId, 'EXECUTOR_NOT_IMPLEMENTED', '该实验的契约已就绪，但执行器尚未接入', {
    retryable: false,
    rootCause: '当前仅完成通用页面壳与三个纯本地确定性执行器。',
    retryInstruction: '无需重试，请等待对应技术 Spike 完成。',
    stopCondition: '保持停止，不要尝试绕过页面调用模型或真实工具。',
    nextActions: ['查看 Schema 与黄金测试状态。'],
  })
}
