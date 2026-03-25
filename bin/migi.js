#!/usr/bin/env node
import readline from 'readline'
import chalk from 'chalk'
import dotenv from 'dotenv'
import { MigiAgent } from '../src/agent.js'
import { loadContext } from '../src/context.js'
import { loadGlobalConfig, runSetup } from '../src/setup.js'

dotenv.config()

// ---- APIキー・設定の解決（優先度: 環境変数 > グローバル設定 > セットアップ） ----
let apiKey = process.env.OPENAI_API_KEY
let model = 'gpt-4o'

if (!apiKey) {
  const config = loadGlobalConfig()
  if (config?.openai_api_key) {
    apiKey = config.openai_api_key
    model = config.model || 'gpt-4o'
  } else {
    // 初回: 対話セットアップ
    const config = await runSetup()
    apiKey = config.openai_api_key
    model = config.model || 'gpt-4o'
  }
}

// ---- コンテキスト読み込み ----
const { context, loaded } = loadContext(process.cwd())

// ---- 起動メッセージ ----
console.log(chalk.bold.cyan('\n  Migi v0.1.0  —  by MAKE U FREE'))
console.log(chalk.gray(`  モデル: ${model}`))
if (loaded.length > 0) {
  console.log(chalk.dim(`  コンテキスト: ${loaded.join(', ')}`))
}
console.log(chalk.dim('  /exit で終了\n'))

// ---- readline セットアップ ----
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const promptFn = (q) => new Promise((resolve) => rl.question(q, resolve))

const agent = new MigiAgent({ context, promptFn, apiKey, model })

// ---- メインループ ----
function prompt() {
  rl.question(chalk.cyan('> '), async (line) => {
    const input = line.trim()

    if (!input) return prompt()

    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan('\n  お疲れ様でした！\n'))
      process.exit(0)
    }

    // 設定変更コマンド
    if (input === '/config') {
      const { runSetup } = await import('../src/setup.js')
      await runSetup()
      console.log(chalk.yellow('  再起動して設定を反映してください。\n'))
      return prompt()
    }

    try {
      const reply = await agent.chat(input)
      console.log('\n' + reply + '\n')
    } catch (err) {
      console.error(chalk.red('\n  エラー: ' + err.message + '\n'))
    }

    prompt()
  })
}

prompt()
