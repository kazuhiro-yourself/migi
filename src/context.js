import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { glob } from 'glob'

/**
 * カレントディレクトリから関連するコンテキストファイルをすべて読み込む
 * 優先度: グローバルメモリ → ワークスペースメモリ → CLAUDE.md → .company/**\/CLAUDE.md
 */
export async function loadContext(cwd = process.cwd()) {
  const parts = []
  const loaded = []

  const load = (label, path) => {
    if (existsSync(path)) {
      parts.push(`### ${label}\n${readFileSync(path, 'utf-8')}`)
      loaded.push(label)
    }
  }

  // 1. グローバルメモリ (~/.migi/memory.md)
  load('グローバルメモリ', join(homedir(), '.migi', 'memory.md'))

  // 2. ワークスペースメモリ (.migi/memory.md)
  load('ワークスペースメモリ', join(cwd, '.migi', 'memory.md'))

  // 3. ルートの CLAUDE.md
  load('CLAUDE.md', join(cwd, 'CLAUDE.md'))

  // 4. .company/ 以下のすべての CLAUDE.md（secretary を最初に）
  const companyDir = join(cwd, '.company')
  if (existsSync(companyDir)) {
    const files = await glob('**/CLAUDE.md', { cwd: companyDir })

    // CLAUDE.md（ルート）→ secretary → その他 の順に読む
    files.sort((a, b) => {
      if (a === 'CLAUDE.md') return -1
      if (b === 'CLAUDE.md') return 1
      if (a.startsWith('secretary')) return -1
      if (b.startsWith('secretary')) return 1
      return a.localeCompare(b)
    })

    for (const file of files) {
      load(`.company/${file}`, join(companyDir, file))
    }
  }

  return { context: parts.join('\n\n---\n\n'), loaded }
}
