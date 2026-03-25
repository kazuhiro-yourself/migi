#!/usr/bin/env node
import '../src/tls.js'  // 企業CA（Zscaler等）を起動直後に読み込む
import readline from 'readline'
import chalk from 'chalk'
import dotenv from 'dotenv'
import { MigiAgent } from '../src/agent.js'
import { loadContext } from '../src/context.js'
import { loadGlobalConfig, runSetup } from '../src/setup.js'
import { resolveSkill, parseSkillInput, expandSkill } from '../src/skills.js'
import { isEmptyWorkspace, runOnboarding } from '../src/onboarding.js'

dotenv.config()

// ---- readline を最初に作る（全ての対話で共用） ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const promptFn = (q) => new Promise((resolve) => rl.question(q, resolve))

// ---- APIキー・設定の解決（優先度: 環境変数 > グローバル設定 > セットアップ） ----
let apiKey = process.env.OPENAI_API_KEY
let model = 'gpt-4.1-2025-04-14'
let agentName = 'Migi'
let userName = ''
let teamsWebhookUrl = ''

if (!apiKey) {
  const config = loadGlobalConfig()
  if (config?.openai_api_key) {
    apiKey = config.openai_api_key
    model = config.model || 'gpt-4.1-2025-04-14'
    agentName = config.name || 'Migi'
    userName = config.user_name || ''
    teamsWebhookUrl = config.teams_webhook_url || ''
  } else {
    const config = await runSetup(promptFn)
    apiKey = config.openai_api_key
    model = config.model || 'gpt-4.1-2025-04-14'
    agentName = config.name || 'Migi'
    userName = config.user_name || ''
    teamsWebhookUrl = config.teams_webhook_url || ''
  }
}

// ---- 空ワークスペース検出 → オンボーディング ----
const cwd = process.cwd()
if (isEmptyWorkspace(cwd)) {
  const proceed = await promptFn(
    chalk.cyan('\n  このフォルダにはまだ設定がありません。セットアップしますか？ [Y/n] ')
  )
  if (proceed.trim().toLowerCase() !== 'n') {
    await runOnboarding(cwd, promptFn)
  }
}

// ---- コンテキスト読み込み ----
const { context, loaded } = await loadContext(cwd)

// ---- 起動メッセージ ----
console.log(chalk.bold.cyan(`\n  ${agentName}  —  by MAKE U FREE`))
console.log(chalk.gray(`  モデル: ${model}`))
if (loaded.length > 0) {
  for (const l of loaded) console.log(chalk.dim(`  ✓ ${l}`))
}
console.log(chalk.dim('\n  /secretary  秘書モード'))
console.log(chalk.dim('  /config     設定変更'))
console.log(chalk.dim('  /exit       終了\n'))

const agent = new MigiAgent({ context, promptFn, apiKey, model, name: agentName, userName, teamsWebhookUrl })

// ---- メインループ ----
function prompt() {
  rl.question(chalk.cyan('> '), async (line) => {
    const input = line.trim()
    if (!input) return prompt()

    // --- ビルトインコマンド ---
    if (input === '/exit' || input === '/quit') {
      console.log(chalk.cyan(`\n  お疲れ様でした！またね。\n`))
      process.exit(0)
    }

    if (input === '/config') {
      const current = loadGlobalConfig()
      await runSetup(promptFn, current)
      console.log(chalk.yellow('  再起動して設定を反映してください。\n'))
      return prompt()
    }

    if (input === '/models') {
      try {
        console.log(chalk.dim('\n  利用可能なモデルを取得中...\n'))
        const OpenAI = (await import('openai')).default
        const client = new OpenAI({ apiKey })
        const res = await client.models.list()
        const models = res.data
          .map(m => m.id)
          .filter(id => id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4'))
          .sort()
        console.log(chalk.cyan('  利用可能なモデル:'))
        for (const m of models) {
          const mark = m === model ? chalk.green(' ← 現在') : ''
          console.log(chalk.dim(`  • ${m}`) + mark)
        }
        console.log(chalk.dim('\n  /config でモデルを変更できます。\n'))
      } catch (err) {
        console.error(chalk.red('\n  取得失敗: ' + err.message + '\n'))
      }
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
        console.log(chalk.dim(`  .migi/skills/${parsed.name}.md を作成してください。\n`))
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
