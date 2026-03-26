#!/usr/bin/env node
import '../src/tls.js'  // 企業CA（Zscaler等）を起動直後に読み込む
import readline, { emitKeypressEvents } from 'readline'
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

function sep() {
  const w = process.stdout.columns || 80
  return chalk.dim('─'.repeat(w))
}

function sepWithLabel(label) {
  const w = process.stdout.columns || 80
  const left = '── ' + label + ' '
  const right = '─'.repeat(Math.max(0, w - left.length))
  return chalk.dim(left + right)
}

// ---- チャット入力（Enter送信 / Shift+Enter改行）----
async function readChatInput() {
  return new Promise((resolve) => {
    const PFIRST = '  > '
    const PCONT  = '    '
    const lines = ['']
    let curLine = 0
    let drawnLines = 0

    emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)

    function draw() {
      const w = process.stdout.columns || 80

      // 前回描画分をクリア
      if (drawnLines > 0) {
        process.stdout.write(`\x1b[${drawnLines}A\x1b[1G`)
        for (let i = 0; i < drawnLines; i++) {
          process.stdout.write('\x1b[2K\n')
        }
        process.stdout.write(`\x1b[${drawnLines}A\x1b[1G`)
      }

      // 入力行 + セパレーター + ガイド を描画
      const allLines = [
        ...lines.map((l, i) => chalk.cyan(i === 0 ? PFIRST : PCONT) + l),
        chalk.dim('─'.repeat(w)),
        chalk.dim(`  ✦ ${model}  ·  Shift+Enterで改行 / Enterで送信`)
      ]
      drawnLines = allLines.length
      process.stdout.write(allLines.join('\n') + '\n')

      // カーソルを入力行の末尾に移動
      const linesBelow = drawnLines - curLine
      if (linesBelow > 0) process.stdout.write(`\x1b[${linesBelow}A`)
      const col = (curLine === 0 ? PFIRST : PCONT).length + lines[curLine].length + 1
      process.stdout.write(`\x1b[${col}G`)
    }

    draw()

    const onKey = (str, key) => {
      if (!key) {
        if (str) { lines[curLine] += str; draw() }
        return
      }

      if (key.ctrl && key.name === 'c') {
        process.stdout.write(`\x1b[${drawnLines - curLine}B\n`)
        process.stdin.removeListener('keypress', onKey)
        if (process.stdin.isTTY) process.stdin.setRawMode(false)
        console.log(chalk.cyan('\n  お疲れ様でした！またね。\n'))
        process.exit(0)
      }

      if (key.name === 'return') {
        if (key.shift) {
          // Shift+Enter → 改行
          lines.splice(curLine + 1, 0, '')
          curLine++
          draw()
        } else {
          // Enter → 送信
          const content = lines.join('\n').trim()
          if (!content) return
          process.stdout.write(`\x1b[${drawnLines - curLine}B\n`)
          process.stdin.removeListener('keypress', onKey)
          if (process.stdin.isTTY) process.stdin.setRawMode(false)
          resolve(content)
        }
        return
      }

      if (key.name === 'backspace') {
        if (lines[curLine].length > 0) {
          lines[curLine] = lines[curLine].slice(0, -1)
          draw()
        } else if (curLine > 0) {
          lines.splice(curLine, 1)
          curLine--
          draw()
        }
        return
      }

      if (str && !key.ctrl && !key.meta) {
        lines[curLine] += str
        draw()
      }
    }

    process.stdin.on('keypress', onKey)
  })
}

// ---- メインループ ----
async function prompt() {
  // 入力ボックス上辺（ユーザー名をセパレーターに埋め込む）
  console.log('\n' + sepWithLabel(chalk.bold.cyan(userName || 'あなた')))

  const input = (await readChatInput()).trim()
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
      console.log('\n' + sepWithLabel(chalk.bold.cyan(agentName) + chalk.dim(`  [スキル: ${parsed.name}]`)))
      const expanded = expandSkill(skill.content, parsed.args)
      try {
        const reply = await agent.chat(expanded)
        console.log('\n' + reply + '\n')
      } catch (err) {
        console.error(chalk.red('\n  エラー: ' + err.message + '\n'))
      }
      return prompt()
    } else {
      console.log(chalk.yellow(`\n  スキル「${parsed.name}」が見つかりません。`))
      console.log(chalk.dim(`  .migi/skills/${parsed.name}.md を作成してください。`))
      return prompt()
    }
  }

  // --- 通常チャット ---
  console.log('\n' + sepWithLabel(chalk.bold.cyan(agentName)))
  try {
    const reply = await agent.chat(input)
    console.log('\n' + reply + '\n')
  } catch (err) {
    console.error(chalk.red('\n  エラー: ' + err.message + '\n'))
  }

  prompt()
}

prompt()
