import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { LAB_IDS, runAttention, runLab, runRag, runTokenizer, validateLabInput } from '../src/llm-lab/runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const assetRoot = join(here, '..', 'src', 'llm-lab')
const readJson = async (...parts) => JSON.parse(await readFile(join(assetRoot, ...parts), 'utf8'))
const closeTo = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const matrixCloseTo = (actual, expected, tolerance = 1e-12) => actual.forEach((row, rowIndex) => row.forEach((value, columnIndex) => closeTo(value, expected[rowIndex][columnIndex], tolerance)))

test('六份契约与六份黄金夹具都是有效 JSON，契约默认拒绝顶层多余字段', async () => {
  const contracts = (await readdir(join(assetRoot, 'contracts'))).filter((name) => name.endsWith('.contract.schema.json'))
  const goldens = (await readdir(join(assetRoot, 'golden'))).filter((name) => name.endsWith('.golden.json'))
  assert.equal(contracts.length, 6)
  assert.equal(goldens.length, 6)
  for (const name of contracts) {
    const contract = await readJson('contracts', name)
    assert.equal(contract.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.equal(contract.additionalProperties, false)
    assert.ok(contract.$id.startsWith('https://omnibox.local/schemas/llm-lab/'))
  }
  for (const name of goldens) assert.ok(await readJson('golden', name))
})

test('T-TOK-001 教学 BPE 输出与黄金夹具一致', async () => {
  const fixture = await readJson('golden', 'tokenizer.golden.json')
  const result = runTokenizer(fixture.input)
  assert.notEqual(result.status, 'error')
  assert.deepEqual(result.data.counts, fixture.expected.counts)
  assert.deepEqual(result.data.tokens.map(({ piece, token_id, utf8_start, utf8_end }) => ({ piece, token_id, utf8_start, utf8_end })), fixture.expected.tokens)
  assert.equal(result.audit.lab_ref, LAB_IDS.tokenizer)
})

test('T-ATT-001 与 T-ATT-002 Attention 数值在 1e-12 容差内', async () => {
  const fixture = await readJson('golden', 'attention.golden.json')
  for (const item of fixture.cases) {
    const result = runAttention(item.input)
    assert.equal(result.status, 'success')
    if (item.expected.scale) closeTo(result.data.scale, item.expected.scale, fixture.tolerance)
    matrixCloseTo(result.data.weights, item.expected.weights, fixture.tolerance)
    matrixCloseTo(result.data.output, item.expected.output, fixture.tolerance)
    assert.equal(result.data.invariants.weight_rows_sum_to_one, true)
    assert.equal(result.data.invariants.masked_weights_are_zero, true)
    assert.equal(result.data.invariants.finite_output, true)
  }
})

test('Attention 全屏蔽行返回可恢复错误，不产生 NaN', () => {
  const result = runAttention({
    q: [[1, 0], [0, 1]],
    k: [[1, 0], [0, 1]],
    v: [[1, 2], [3, 4]],
    mask_type: 'custom',
    custom_mask: [[0, 0], [1, 1]],
    precision: 'float64',
  })
  assert.equal(result.status, 'error')
  assert.equal(result.error.code, 'FULLY_MASKED_ROW')
  assert.equal(result.data, null)
  assert.ok(result.error.retry_instruction)
  assert.ok(result.error.stop_condition)
})

test('T-RAG-001 BM25 排名、稳定同分顺序和贡献值一致', async () => {
  const fixture = await readJson('golden', 'rag.golden.json')
  const result = runRag(fixture.input)
  assert.equal(result.status, 'success')
  assert.deepEqual(result.data.results.map((item) => item.chunk_id), fixture.expected.results.map((item) => item.chunk_id))
  result.data.results.forEach((item, index) => closeTo(item.score, fixture.expected.results[index].score, fixture.tolerance))
  assert.deepEqual(result.data.query.terms, ['cat', 'fish'])
})

test('未实现实验只通过契约预检，不允许执行器越权运行', () => {
  const preflight = validateLabInput(LAB_IDS.toolCalling, null)
  assert.equal(preflight.status, 'warning')
  assert.equal(preflight.data.executable, false)
  const execution = runLab(LAB_IDS.toolCalling, {})
  assert.equal(execution.status, 'error')
  assert.equal(execution.error.code, 'EXECUTOR_NOT_IMPLEMENTED')
  assert.equal(execution.error.retryable, false)
})
