import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import readline from 'readline'
import chalk from 'chalk'

export const MIGI_DIR = join(homedir(), '.migi')
export const CONFIG_PATH = join(MIGI_DIR, 'config.json')

export function loadGlobalConfig() {
  if (!existsSync(CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return null
  }
}

export function saveGlobalConfig(config) {
  mkdirSync(MIGI_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export async function runSetup() {
  console.log(chalk.bold.cyan('\n  Migi v0.1.0  —  by MAKE U FREE'))
  console.log(chalk.cyan('  ─────────────────────────────────'))
  console.log(chalk.white('  初めまして！右腕のセットアップを始めます。\n'))

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve))

  // --- API キー ---
  console.log(chalk.dim('  OpenAI APIキーを入力してください。'))
  console.log(chalk.dim('  取得: https://platform.openai.com/api-keys\n'))
  const apiKey = await ask(chalk.white('  API キー > '))

  if (!apiKey.trim()) {
    console.log(chalk.red('\n  APIキーが入力されていません。終了します。\n'))
    rl.close()
    process.exit(1)
  }

  // --- モデル選択 ---
  console.log('')
  console.log(chalk.dim('  使用するモデルを選んでください。'))
  console.log(chalk.dim('  1) gpt-4o        （高性能・推奨）'))
  console.log(chalk.dim('  2) gpt-4o-mini   （高速・低コスト）'))
  console.log(chalk.dim('  3) その他        （直接入力）\n'))
  const modelChoice = await ask(chalk.white('  選択 [1] > '))

  let model = 'gpt-4o'
  if (modelChoice.trim() === '2') {
    model = 'gpt-4o-mini'
  } else if (modelChoice.trim() === '3') {
    const custom = await ask(chalk.white('  モデル名 > '))
    model = custom.trim() || 'gpt-4o'
  }

  // --- 保存 ---
  const config = { openai_api_key: apiKey.trim(), model }
  saveGlobalConfig(config)

  rl.close()

  console.log(chalk.green(`\n  セットアップ完了！`))
  console.log(chalk.dim(`  設定を保存しました: ${CONFIG_PATH}`))
  console.log(chalk.dim(`  モデル: ${model}\n`))
  console.log(chalk.cyan('  ─────────────────────────────────\n'))

  return config
}
