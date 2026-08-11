import { Binary, BrainCircuit, ChartNoAxesCombined, Database, Grid3X3, Split, Wrench } from 'lucide-react'
import tokenizerContract from './contracts/tokenizer.contract.schema.json'
import attentionContract from './contracts/attention.contract.schema.json'
import promptContract from './contracts/prompt-compare.contract.schema.json'
import ragContract from './contracts/rag.contract.schema.json'
import toolContract from './contracts/tool-calling.contract.schema.json'
import evalContract from './contracts/eval-runner.contract.schema.json'
import tokenizerGolden from './golden/tokenizer.golden.json'
import attentionGolden from './golden/attention.golden.json'
import promptGolden from './golden/prompt-compare.golden.json'
import ragGolden from './golden/rag.golden.json'
import toolGolden from './golden/tool-calling.golden.json'
import evalGolden from './golden/eval-runner.golden.json'
import { LAB_IDS } from './runtime.mjs'

export const llmLabCatalog = [
  {
    id: LAB_IDS.tokenizer,
    slug: 'tokenizer',
    title: 'Tokenizer 可视化',
    shortTitle: 'Tokenizer',
    description: '观察字符、Grapheme 与教学 BPE Token 的差异。',
    icon: Binary,
    executable: true,
    mode: '纯本地',
    contract: tokenizerContract,
    golden: tokenizerGolden,
  },
  {
    id: LAB_IDS.attention,
    slug: 'attention',
    title: '小型 Attention',
    shortTitle: 'Attention',
    description: '逐步检查 QKᵀ、缩放、Mask、Softmax 与输出矩阵。',
    icon: Grid3X3,
    executable: true,
    mode: '纯本地',
    contract: attentionContract,
    golden: attentionGolden,
  },
  {
    id: LAB_IDS.promptCompare,
    slug: 'prompt-compare',
    title: 'Prompt 对比',
    shortTitle: 'Prompt 对比',
    description: '用固定样本和明确评分器比较 Prompt 变体。',
    icon: Split,
    executable: false,
    mode: '夹具 / 模型',
    contract: promptContract,
    golden: promptGolden,
  },
  {
    id: LAB_IDS.rag,
    slug: 'rag',
    title: 'RAG Debugger',
    shortTitle: 'RAG',
    description: '使用可复算 BM25 观察召回排名与 term contribution。',
    icon: Database,
    executable: true,
    mode: '纯本地',
    contract: ragContract,
    golden: ragGolden,
  },
  {
    id: LAB_IDS.toolCalling,
    slug: 'tool-calling',
    title: 'Tool Calling',
    shortTitle: 'Tool Calling',
    description: '拆解候选调用、Schema、策略、执行与观察结果。',
    icon: Wrench,
    executable: false,
    mode: '模拟工具',
    contract: toolContract,
    golden: toolGolden,
  },
  {
    id: LAB_IDS.evalRunner,
    slug: 'eval-runner',
    title: 'Eval Runner',
    shortTitle: 'Eval',
    description: '在固定数据集上区分任务失败、执行错误和评分错误。',
    icon: ChartNoAxesCombined,
    executable: false,
    mode: '静态夹具',
    contract: evalContract,
    golden: evalGolden,
  },
]

export const llmLabToolIcon = BrainCircuit
