import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import readline from 'readline'
import chalk from 'chalk'
import OpenAI from 'openai'

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

async function extractName(apiKey, model, input) {
  if (!input) return 'Migi'
  try {
    const client = new OpenAI({ apiKey })
    const res = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `ユーザーが AI エージェントにつけたい名前を入力しました。\n入力: "${input}"\n\n入力から名前だけを抽出して、その名前のみを返してください。説明不要。`
      }],
      max_tokens: 20,
    })
    return res.choices[0].message.content.trim() || input
  } catch {
    return input
  }
}

export function saveGlobalConfig(config) {
  mkdirSync(MIGI_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export async function runSetup(promptFn = null) {
  // readline を外から受け取るか、自前で作る
  let rl = null
  let ask = promptFn
  if (!ask) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    ask = (q) => new Promise((resolve) => rl.question(q, resolve))
  }

  // ---- 自己紹介 ----
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║   Migi  —  by MAKE U FREE            ║'))
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝\n'))
  console.log(chalk.white('  はじめまして！'))
  console.log(chalk.white('  私はあなたの右腕として動く AI エージェントです。\n'))
  console.log(chalk.dim('  タスク管理・壁打ち・ファイル操作・コマンド実行...'))
  console.log(chalk.dim('  仕事も人生も、何でも一緒に動きます。\n'))
  console.log(chalk.dim('  ─────────────────────────────────────\n'))

  // ---- API キー ----
  console.log(chalk.dim('  まず OpenAI API キーを設定しましょう。'))
  console.log(chalk.dim('  取得: https://platform.openai.com/api-keys\n'))
  const apiKey = await ask(chalk.white('  API キー > '))

  if (!apiKey.trim()) {
    console.log(chalk.red('\n  API キーが入力されていません。終了します。\n'))
    if (rl) rl.close()
    process.exit(1)
  }

  // ---- モデル選択 ----
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

  // ---- 名前（AIで解釈） ----
  console.log('')
  console.log(chalk.white('  ひとつお願いがあります。'))
  console.log(chalk.white('  ─── 名前をつけてもらえますか？ ───\n'))
  console.log(chalk.dim('  あなただけの右腕として、その名前で動きます。'))
  console.log(chalk.dim('  例: ミギ、アシ、レン、なんでも OK\n'))

  const nameInput = await ask(chalk.cyan('  名前 > '))
  const name = await extractName(apiKey.trim(), model, nameInput.trim())

  console.log(chalk.green(`\n  ${name} です。よろしくお願いします！\n`))

  // ---- 保存 ----
  const config = { name, openai_api_key: apiKey.trim(), model }
  saveGlobalConfig(config)
  if (rl) rl.close()

  console.log(chalk.dim(`  設定を保存しました: ${CONFIG_PATH}`))
  console.log(chalk.dim(`  名前: ${name} / モデル: ${model}\n`))
  console.log(chalk.cyan('  ─────────────────────────────────────\n'))

  return config
}
