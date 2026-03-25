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

function maskApiKey(key) {
  if (!key || key.length < 8) return '****'
  return key.slice(0, 7) + '...' + key.slice(-4)
}

export function saveGlobalConfig(config) {
  mkdirSync(MIGI_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

// existingConfig を渡すと「更新モード」になり、各項目を Enter でスキップできる
export async function runSetup(promptFn = null, existingConfig = null) {
  const isUpdate = !!existingConfig

  // readline を外から受け取るか、自前で作る
  let rl = null
  let ask = promptFn
  if (!ask) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    ask = (q) => new Promise((resolve) => rl.question(q, resolve))
  }

  if (isUpdate) {
    // ---- 更新モード ----
    console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'))
    console.log(chalk.bold.cyan('  ║   設定を変更します                    ║'))
    console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝'))
    console.log(chalk.dim('  Enter でスキップ（現在値を維持）\n'))
  } else {
    // ---- 初回セットアップ ----
    console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════╗'))
    console.log(chalk.bold.cyan('  ║   Migi  —  by MAKE U FREE            ║'))
    console.log(chalk.bold.cyan('  ╚══════════════════════════════════════╝\n'))
    console.log(chalk.white('  はじめまして！'))
    console.log(chalk.white('  私はあなたの右腕として動く AI エージェントです。\n'))
    console.log(chalk.dim('  タスク管理・壁打ち・ファイル操作・コマンド実行...'))
    console.log(chalk.dim('  仕事も人生も、何でも一緒に動きます。\n'))
    console.log(chalk.dim('  ─────────────────────────────────────\n'))
  }

  // ---- API キー ----
  if (!isUpdate) {
    console.log(chalk.dim('  まず OpenAI API キーを設定しましょう。'))
    console.log(chalk.dim('  取得: https://platform.openai.com/api-keys\n'))
  }
  const apiKeyPrompt = isUpdate
    ? chalk.white(`  API キー [${maskApiKey(existingConfig.openai_api_key)}] > `)
    : chalk.white('  API キー > ')
  const apiKeyInput = await ask(apiKeyPrompt)
  const apiKey = apiKeyInput.trim() || (isUpdate ? existingConfig.openai_api_key : '')

  if (!apiKey) {
    console.log(chalk.red('\n  API キーが入力されていません。終了します。\n'))
    if (rl) rl.close()
    process.exit(1)
  }

  // ---- モデル選択 ----
  console.log('')
  console.log(chalk.dim('  使用するモデルを選んでください。'))
  console.log(chalk.dim('  1) gpt-4.1-2025-04-14  （推奨・エージェント特化）'))
  console.log(chalk.dim('  2) gpt-4o              （汎用）'))
  console.log(chalk.dim('  3) gpt-4o-mini         （高速・低コスト）'))
  console.log(chalk.dim('  4) その他              （直接入力）'))
  if (isUpdate) console.log(chalk.dim(`  現在: ${existingConfig.model}`))
  console.log('')
  const modelChoice = await ask(chalk.white('  選択 [1] > '))

  let model = isUpdate ? existingConfig.model : 'gpt-4.1-2025-04-14'
  if (modelChoice.trim() === '1') {
    model = 'gpt-4.1-2025-04-14'
  } else if (modelChoice.trim() === '2') {
    model = 'gpt-4o'
  } else if (modelChoice.trim() === '3') {
    model = 'gpt-4o-mini'
  } else if (modelChoice.trim() === '4') {
    const custom = await ask(chalk.white('  モデル名 > '))
    model = custom.trim() || model
  }
  // 空Enter → 既存値のまま（modelはすでに既存値がセットされている）

  // ---- みぎの名前（AIで解釈） ----
  console.log('')
  if (!isUpdate) {
    console.log(chalk.white('  ひとつお願いがあります。'))
    console.log(chalk.white('  ─── 名前をつけてもらえますか？ ───\n'))
    console.log(chalk.dim('  あなただけの右腕として、その名前で動きます。'))
    console.log(chalk.dim('  例: ミギ、アシ、レン、なんでも OK\n'))
  }
  const namePrompt = isUpdate
    ? chalk.cyan(`  みぎの名前 [${existingConfig.name}] > `)
    : chalk.cyan('  名前 > ')
  const nameInput = await ask(namePrompt)
  const name = nameInput.trim()
    ? await extractName(apiKey, model, nameInput.trim())
    : (isUpdate ? existingConfig.name : 'Migi')

  // ---- ユーザー名 ----
  console.log('')
  const currentUserName = isUpdate ? existingConfig.user_name || '' : ''
  const userNamePrompt = isUpdate && currentUserName
    ? chalk.cyan(`  あなたのお名前 [${currentUserName}] > `)
    : chalk.cyan('  あなたのことは何とお呼びすればいいですか？ > ')
  if (!isUpdate) {
    console.log(chalk.dim('  お名前（ニックネームでもOK）を教えてください。\n'))
  }
  const userNameInput = await ask(userNamePrompt)
  const userName = userNameInput.trim() || currentUserName

  console.log(chalk.green(`\n  ${name} です。${userName ? userName + 'さん、' : ''}よろしくお願いします！\n`))

  // ---- 保存 ----
  const config = { name, user_name: userName, openai_api_key: apiKey, model }
  saveGlobalConfig(config)
  if (rl) rl.close()

  console.log(chalk.dim(`  設定を保存しました: ${CONFIG_PATH}`))
  console.log(chalk.dim(`  名前: ${name}${userName ? ' / ユーザー: ' + userName : ''} / モデル: ${model}\n`))
  console.log(chalk.cyan('  ─────────────────────────────────────\n'))

  return config
}
