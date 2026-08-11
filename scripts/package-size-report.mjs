import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MIB = 1024 * 1024
const releaseDir = join(process.cwd(), 'release')
const macOutput = existsSync(releaseDir)
  ? readdirSync(releaseDir)
    .filter((name) => name.startsWith('mac') && existsSync(join(releaseDir, name, 'OmniBox.app')))
    .map((name) => join(releaseDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
  : undefined

if (!macOutput) {
  console.error('未找到 release/mac*/OmniBox.app，请先执行 npm run build:mac。')
  process.exit(1)
}

const appPath = join(macOutput, 'OmniBox.app')
const resourcesPath = join(appPath, 'Contents', 'Resources')
const visionDir = join(process.cwd(), 'component-dist', 'vision')
const visionAsset = existsSync(visionDir)
  ? readdirSync(visionDir).map((name) => join(visionDir, name)).find((path) => /omnibox-vision-runtime-(darwin|win32|linux)-/.test(path))
  : undefined
const artifacts = readdirSync(releaseDir)
  .filter((name) => /\.(dmg|zip)$/.test(name))
  .map((name) => ({ name, path: join(releaseDir, name), bytes: statSync(join(releaseDir, name)).size }))
  .sort((left, right) => right.bytes - left.bytes)

function diskBytes(path) {
  const output = execFileSync('du', ['-sk', path], { encoding: 'utf8' }).trim()
  return Number.parseInt(output.split(/\s+/)[0], 10) * 1024
}

const measurements = [
  { name: '安装后的应用', bytes: diskBytes(appPath), budget: 285 * MIB },
  { name: 'Electron Frameworks', bytes: diskBytes(join(appPath, 'Contents', 'Frameworks')) },
  { name: 'Python 核心后端', bytes: diskBytes(join(resourcesPath, 'backend')), budget: 30 * MIB },
  { name: 'app.asar', bytes: diskBytes(join(resourcesPath, 'app.asar')), budget: 10 * MIB },
  ...artifacts.map((item) => ({ name: item.name, bytes: item.bytes, budget: 160 * MIB })),
  ...(visionAsset ? [{ name: '可选视觉组件（不入基础包）', bytes: statSync(visionAsset).size, budget: 100 * MIB }] : []),
]

const display = (bytes) => `${(bytes / MIB).toFixed(1)} MiB`
console.log('\nOmniBox 发布体积')
console.table(measurements.map((item) => ({
  项目: item.name,
  当前: display(item.bytes),
  预算: item.budget ? display(item.budget) : '-',
  状态: !item.budget || item.bytes <= item.budget ? 'OK' : '超出',
})))

if (process.argv.includes('--check')) {
  const oversized = measurements.filter((item) => item.budget && item.bytes > item.budget)
  if (oversized.length) {
    console.error(`体积预算检查失败：${oversized.map((item) => `${item.name} ${display(item.bytes)}`).join('；')}`)
    process.exit(1)
  }
  console.log('体积预算检查通过。')
}
