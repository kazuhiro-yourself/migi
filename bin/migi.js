#!/usr/bin/env node
import readline from 'readline'
import chalk from 'chalk'
import dotenv from 'dotenv'
import { MigiAgent } from '../src/agent.js'
import { loadContext } from '../src/context.js'
import { loadGlobalConfig, runSetup } from '../src/setup.js'
import { resolveSkill, parseSkillInput, expandSkill } from '../src/skills.js'
import { isEmptyWorkspace, runOnboarding } from '../src/onboarding.js'

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
    const config = await runSetup()
    apiKey = config.openai_api_key
    model = config.model || 'gpt-4o'
  }
}

// ---- readline を先に作る（オンボーディングでも使うため） ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const promptFn = (q) => new Promise((resolve) => rl.question(q, resolve))

// ---- 空ワークスペース検出 → オンボーディング ----
const cwd = process.cwd()
if (isEmptyWorkspace(cwd)) {
  const proceed = await promptFn(
    chalk.cyan('\n  Migi v0.1.0  —  by MAKE U FREE\n') +
    chalk.white('\n  このフォルダにはまだ設定がありません。セットアップしますか？ [Y/n] ')
  )
  if (proceed.trim().toLowerCase() !== 'n') {
    await runOnboarding(cwd, promptFn)
  }
}

// ---- コンテキスト読み込み ----
const { context, loaded } = await loadContext(cwd)

// ---- 起動メッセージ ----
console.log(chalk.bold.cyan('\n  Migi v0.1.0  —  by MAKE U FREE'))
console.log(chalk.gray(`  モデル: ${model}`))
if (loaded.length > 0) {
  for (const l of loaded) console.log(chalk.dim(`  ✓ ${l}`))
}
console.log(chalk.dim('\n  /secretary  秘書モード'))
console.log(chalk.dim('  /config     設定変更'))
console.log(chalk.dim('  /exit       終了\n'))

const agent = new MigiAgent({ context, promptFn, apiKey, model })

// ---- メインループ ----
function prompt() {
  rl.question(chalk.cyan('> '), async (line) => {
    const input = line.trim()
    if (!input) return prompt()

    // --- ビルトインコマンド ---
    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan('\n  お疲れ様でした！\n'))
      process.exit(0)
    }

    if (input === '/config') {
      await runSetup()
      console.log(chalk.yellow('  再起動して設定を反映してください。\n'))
      return prompt()
    }

    // --- スキルルーティング ---
    const parsed = parseSkillInput(input)
    if (parsed) {
      const skill = resolveSkill(parsed.name, process.cwd())
      if (skill) {
        console.log(chalk.dim(`  [スキル: ${parsed.name}]\n`))
        const expanded = expandSkill(skill.content, parsed.args)
        try {
          const reply = await agent.chat(expanded)
          console.log('\n' + reply + '\n')
        } catch (err) {
          console.error(chalk.red('\n  エラー: ' + err.message + '\n'))
        }
        return prompt()
      } else {
        console.log(chalk.yellow(`  スキル「${parsed.name}」が見つかりません。`))
        console.log(chalk.dim(`  .migi/skills/${parsed.name}.md を作成するか、ビルトインスキルを使ってください。\n`))
        return prompt()
      }
    }

    // --- 通常チャット ---
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
