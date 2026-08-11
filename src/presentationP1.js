import themes from './presentation-themes.json'

export const PRESENTATION_THEMES = themes

export function localQualityCheck(deck) {
  const issues = []
  ;(deck?.slides || []).forEach((item, index) => {
    const page = index + 1
    const body = item.body || []
    const characters = body.join('').length
    if ((item.title || '').length > 32) issues.push({ severity: 'warning', page, code: 'long_title', message: '标题超过 32 个字，投影时不易快速阅读' })
    if (body.length > 6) issues.push({ severity: 'warning', page, code: 'too_many_points', message: `包含 ${body.length} 个要点，建议控制在 6 个以内` })
    if (characters > 360) issues.push({ severity: 'error', page, code: 'dense_content', message: `正文约 ${characters} 字，页面信息过密` })
    if (body.some((text) => text.length > 100)) issues.push({ severity: 'warning', page, code: 'long_point', message: '存在超过 100 字的单条要点，建议拆分' })
    if (!body.length && !item.images?.length && !item.chart && index > 0) issues.push({ severity: 'info', page, code: 'empty_page', message: '页面只有标题，请补充内容或视觉材料' })
  })
  return issues
}
