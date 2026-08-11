import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { basename, join } from 'node:path'

const version = process.env.OMNIBOX_VISION_VERSION || '1.0.0'
const targetPlatform = platform() === 'win32' ? 'win32' : platform() === 'darwin' ? 'darwin' : 'linux'
const targetArch = ['arm64', 'aarch64'].includes(arch()) ? 'arm64' : ['x64', 'x86_64'].includes(arch()) ? 'x64' : arch()
const extension = targetPlatform === 'win32' ? '.exe' : ''
const source = join(process.cwd(), 'component-dist', `omnibox-vision-runtime${extension}`)
const outputDir = join(process.cwd(), 'component-dist', 'vision')
const assetName = `omnibox-vision-runtime-${targetPlatform}-${targetArch}${extension}`
const asset = join(outputDir, assetName)

if (!existsSync(source)) {
  console.error(`未找到视觉组件构建产物：${source}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })
rmSync(asset, { force: true })
try {
  linkSync(source, asset)
} catch {
  copyFileSync(source, asset)
}

const hash = createHash('sha256')
await new Promise((resolve, reject) => createReadStream(asset).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject))
const sha256 = hash.digest('hex')
const size = statSync(asset).size
const releaseTag = `vision-runtime-v${version}`
const releaseBase = process.env.OMNIBOX_VISION_RELEASE_BASE || `https://github.com/Yicijiuhaobala/OmniBox/releases/download/${releaseTag}`
const catalogPath = join(outputDir, 'catalog.json')
const existing = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { schema_version: 1, component: 'vision-runtime', releases: [] }
const releases = (existing.releases || []).filter((item) => item.platform !== targetPlatform || item.arch !== targetArch)
releases.push({
  platform: targetPlatform,
  arch: targetArch,
  version,
  url: `${releaseBase.replace(/\/$/, '')}/${assetName}`,
  sha256,
  size,
  capabilities: ['ocr', 'inpaint'],
})
const catalog = { schema_version: 1, component: 'vision-runtime', releases }
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
writeFileSync(join(outputDir, 'release-info.json'), `${JSON.stringify({ releaseTag, asset: basename(asset), sha256, size }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ releaseTag, asset, catalog: catalogPath, sha256, size }, null, 2))
