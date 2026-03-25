#!/usr/bin/env node
import readline from 'readline'
import chalk from 'chalk'
import dotenv from 'dotenv'
import { MigiAgent } from '../src/agent.js'
import { loadContext } from '../src/context.js'

dotenv.config()

// API キーチェック
if (!process.env.OPENAI_API_KEY) {
  console.error(chalk.red('\n  Error: OPENAI_API_KEY が設定されていません'))
  console.error(chalk.gray('  .env ファイルに以下を追加してください:'))
  console.error(chalk.gray('  OPENAI_API_KEY=sk-...\n'))
  process.exit(1)
}

// コンテキスト読み込み
const { context, loaded } = loadContext(process.cwd())

// 起動メッセージ
console.log(chalk.bold.cyan('\n  Migi v0.1.0  —  by MAKE U FREE'))
console.log(chalk.gray('  あなたの右腕、起動しました。\n'))
if (loaded.length > 0) {
  console.log(chalk.dim(`  コンテキスト: ${loaded.join(', ')}`))
}
console.log(chalk.dim('  /exit で終了\n'))

// readline セットアップ
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// rl.question を Promise 化して Agent に渡す
const promptFn = (q) => new Promise((resolve) => rl.question(q, resolve))

const agent = new MigiAgent({ context, promptFn })

// メインループ
function prompt() {
  rl.question(chalk.cyan('> '), async (line) => {
    const input = line.trim()

    if (!input) return prompt()

    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan('\n  お疲れ様でした！\n'))
      process.exit(0)
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
