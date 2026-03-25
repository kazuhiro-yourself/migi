import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { glob } from 'glob'

/**
 * カレントディレクトリから関連するコンテキストファイルをすべて読み込む
 * 優先度: グローバルメモリ → ワークスペースメモリ → CLAUDE.md → .company/**\/CLAUDE.md
 */
export async function loadContext(cwd = process.cwd()) {
  const parts = []
  const loaded = []

  // MIGI.md を優先、なければ CLAUDE.md にフォールバック
  const loadWithFallback = (labelPrefix, dir, filename) => {
    const migiPath = join(dir, 'MIGI.md')
    const claudePath = join(dir, filename)
    if (existsSync(migiPath)) {
      parts.push(`### ${labelPrefix}MIGI.md\n${readFileSync(migiPath, 'utf-8')}`)
      loaded.push(`${labelPrefix}MIGI.md`)
    } else if (existsSync(claudePath)) {
      parts.push(`### ${labelPrefix}${filename}\n${readFileSync(claudePath, 'utf-8')}`)
      loaded.push(`${labelPrefix}${filename}`)
    }
  }

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

  // 3. ルートの MIGI.md → CLAUDE.md
  loadWithFallback('', cwd, 'CLAUDE.md')

  // 4. .company/ 以下（MIGI.md 優先、なければ CLAUDE.md）
  const companyDir = join(cwd, '.company')
  if (existsSync(companyDir)) {
    const migiFiles = await glob('**/MIGI.md', { cwd: companyDir })
    const claudeFiles = await glob('**/CLAUDE.md', { cwd: companyDir })

    // MIGI.md があるディレクトリは MIGI.md を使い、CLAUDE.md はスキップ
    const migiDirs = new Set(migiFiles.map(f => dirname(f)))
    const allFiles = [
      ...migiFiles,
      ...claudeFiles.filter(f => !migiDirs.has(dirname(f)))
    ]

    // ルート → secretary → その他 の順
    allFiles.sort((a, b) => {
      const aBase = a.replace(/\/(MIGI|CLAUDE)\.md$/, '').replace(/^(MIGI|CLAUDE)\.md$/, '')
      const bBase = b.replace(/\/(MIGI|CLAUDE)\.md$/, '').replace(/^(MIGI|CLAUDE)\.md$/, '')
      if (!aBase) return -1
      if (!bBase) return 1
      if (aBase.startsWith('secretary')) return -1
      if (bBase.startsWith('secretary')) return 1
      return aBase.localeCompare(bBase)
    })

    for (const file of allFiles) {
      load(`.company/${file}`, join(companyDir, file))
    }
  }

  return { context: parts.join('\n\n---\n\n'), loaded }
}
