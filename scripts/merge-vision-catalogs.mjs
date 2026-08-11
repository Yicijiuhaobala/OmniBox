import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const inputRoot = resolve(process.argv[2] || 'artifacts')
const outputPath = resolve(process.argv[3] || 'release-assets/catalog.json')

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

if (!existsSync(inputRoot)) {
  console.error(`组件目录不存在：${inputRoot}`)
  process.exit(1)
}

const catalogPaths = filesUnder(inputRoot).filter((path) => path.endsWith('catalog.json'))
const releases = []
for (const path of catalogPaths) {
  const catalog = JSON.parse(readFileSync(path, 'utf8'))
  if (catalog.schema_version !== 1 || catalog.component !== 'vision-runtime' || !Array.isArray(catalog.releases)) {
    throw new Error(`组件目录格式无效：${path}`)
  }
  for (const release of catalog.releases) {
    const key = `${release.platform}-${release.arch}`
    if (releases.some((item) => `${item.platform}-${item.arch}` === key)) throw new Error(`组件平台重复：${key}`)
    releases.push(release)
  }
}
if (!releases.length) throw new Error('没有找到任何视觉组件发布条目')
releases.sort((left, right) => `${left.platform}-${left.arch}`.localeCompare(`${right.platform}-${right.arch}`))
for (const release of releases) {
  const assetName = new URL(release.url).pathname.split('/').pop()
  const asset = filesUnder(inputRoot).find((path) => path.endsWith(assetName))
  if (!asset || statSync(asset).size !== release.size) throw new Error(`组件资产缺失或大小不一致：${assetName}`)
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify({ schema_version: 1, component: 'vision-runtime', releases }, null, 2)}\n`, 'utf8')
console.log(`已合并 ${releases.length} 个平台组件：${outputPath}`)
