import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * スキルを解決して内容を返す
 * 優先度: .migi/skills/{name}.md（ユーザー定義）> skills/{name}.md（ビルトイン）
 */
export function resolveSkill(name, cwd = process.cwd()) {
  const candidates = [
    join(cwd, '.migi', 'skills', `${name}.md`),       // ユーザー定義
    join(PACKAGE_DIR, 'skills', `${name}.md`),         // ビルトイン
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      return { content: readFileSync(path, 'utf-8'), path }
    }
  }

  return null
}

/**
 * 入力が /コマンド 形式かチェックし、スキル名と残りの入力を返す
 */
export function parseSkillInput(input) {
  if (!input.startsWith('/')) return null
  const [cmd, ...rest] = input.slice(1).split(' ')
  return { name: cmd, args: rest.join(' ') }
}

/**
 * スキルをメッセージに展開する
 */
export function expandSkill(skillContent, args) {
  const argSection = args ? `\n\nユーザーの入力: ${args}` : ''
  return `以下のスキル定義に従って動作してください:\n\n${skillContent}${argSection}`
}
