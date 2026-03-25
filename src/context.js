import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * カレントディレクトリから関連するコンテキストファイルを読み込む
 * 優先度: .migi/memory.md → CLAUDE.md → .company/CLAUDE.md
 */
export function loadContext(cwd = process.cwd()) {
  const parts = []
  const loaded = []

  const candidates = [
    { path: join(cwd, '.migi', 'memory.md'), label: 'Memory' },
    { path: join(cwd, 'CLAUDE.md'), label: 'CLAUDE.md' },
    { path: join(cwd, '.company', 'CLAUDE.md'), label: '.company/CLAUDE.md' },
  ]

  for (const { path, label } of candidates) {
    if (existsSync(path)) {
      parts.push(`### ${label}\n${readFileSync(path, 'utf-8')}`)
      loaded.push(label)
    }
  }

  return { context: parts.join('\n\n'), loaded }
}
