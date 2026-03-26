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
import { createRequire } from 'module'
const { version } = createRequire(import.meta.url)('../package.json')

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
console.log(chalk.bold.cyan(`\n  ${agentName}  —  by MAKE U FREE`) + chalk.dim(`  v${version}`))
console.log(chalk.gray(`  モデル: ${model}`))
if (loaded.length > 0) {
  for (const l of loaded) console.log(chalk.dim(`  ✓ ${l}`))
}
console.log(chalk.dim('\n  /secretary  秘書モード'))
console.log(chalk.dim('  /config     設定変更'))
console.log(chalk.dim('  /exit       終了\n'))

const agent = new MigiAgent({ context, promptFn, apiKey, model, name: agentName, userName, teamsWebhookUrl })

// ---- 起動時ダッシュボード ----
{
  const today = new Date().toISOString().split('T')[0]
  console.log('\n' + chalk.bold.cyan(`─── ${agentName} `) + chalk.dim('─'.repeat(Math.max(0, (process.stdout.columns || 80) - agentName.length - 5))))
  try {
    await agent.chat(
      `起動した。以下の手順で今日の状況を確認して、簡潔にダッシュボードを表示してから、今一番優先すべきことを1つだけ提案して：\n` +
      `1. todos/${today}.md を read_file で読んで未完了タスクを確認\n` +
      `2. .migi/memory/next-actions.md があれば読む\n` +
      `3. ダッシュボード（完了済み・未完了の件数サマリー）をコンパクトに出して、一言で「今日はこれから」と提案する\n` +
      `（詳細な説明はいらない。テンポよく）`
    )
  } catch (err) {
    console.error(chalk.red('  起動チェック失敗: ' + err.message))
  }
}

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
// 全角文字（日本語・絵文字など）は端末上で2カラム幅を占める
// string.length はコードポイント数なので、カーソル位置計算に使うと日本語入力でズレる
function displayWidth(str) {
  let w = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    const wide =
      (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
      (cp >= 0x2E80 && cp <= 0x303F) ||  // CJK Radicals
      (cp >= 0x3040 && cp <= 0x33FF) ||  // Hiragana〜CJK Compat
      (cp >= 0x3400 && cp <= 0x9FFF) ||  // CJK Unified
      (cp >= 0xAC00 && cp <= 0xD7FF) ||  // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compat Ideographs
      (cp >= 0xFE10 && cp <= 0xFE1F) ||  // Vertical Forms
      (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compat Forms
      (cp >= 0xFF01 && cp <= 0xFF60) ||  // Fullwidth ASCII
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
      (cp >= 0x1F300 && cp <= 0x1FAFF)   // Emoji
    w += wide ? 2 : 1
  }
  return w
}

async function readChatInput() {
  return new Promise((resolve) => {
    const PFIRST = '  > '
    const PCONT  = '    '
    const lines = ['']
    let curLine = 0
    let drawnLines = 0
    let cursorLine = 0  // カーソルの物理行（drawn area 先頭からの offset）
    let drawPending = false

    emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)

    // ペースト等の連続入力をまとめて1回の描画にするためのデバウンス
    function scheduleDraw() {
      if (drawPending) return
      drawPending = true
      setImmediate(() => { drawPending = false; draw() })
    }

    function draw() {
      const w = process.stdout.columns || 80
      const newLines = [
        ...lines.map((l, i) => chalk.cyan(i === 0 ? PFIRST : PCONT) + l),
        chalk.dim('─'.repeat(w - 1)),  // w-1: 行末での自動折り返し防止
        chalk.dim(`  ✦ ${model}  ·  Alt+Enterで改行 / Enterで送信`)
      ]
      const oldDrawnLines = drawnLines
      drawnLines = newLines.length

      let buf = ''

      // ① drawn area 先頭まで戻る（cursorLine = カーソルが今いる物理行）
      if (cursorLine > 0) buf += `\x1b[${cursorLine}A`
      buf += '\r'

      // ② 各行を上書き。「先クリア→描画」ではなく「描画→行末クリア」でちらつき防止
      for (let i = 0; i < newLines.length; i++) {
        buf += newLines[i] + '\x1b[K'
        if (i < newLines.length - 1) buf += '\r\n'
      }

      // ③ 行数が減った場合、余分な古い行をクリア
      for (let i = newLines.length; i < oldDrawnLines; i++) {
        buf += '\r\n\x1b[2K'
      }

      // ④ curLine の行まで戻る
      // step②+③後のカーソル位置は max(新行数, 旧行数)-1 行目
      const linesFromBottom = Math.max(drawnLines, oldDrawnLines) - 1 - curLine
      if (linesFromBottom > 0) buf += `\x1b[${linesFromBottom}A`
      buf += '\r'

      // ⑤ カーソルを入力内容の末尾へ（全角文字は2カラム幅なので displayWidth を使う）
      const prefix = curLine === 0 ? PFIRST : PCONT
      buf += `\x1b[${prefix.length + displayWidth(lines[curLine]) + 1}G`

      cursorLine = curLine
      process.stdout.write(buf)
    }

    draw()

    const onKey = (str, key) => {
      if (!key) {
        if (str) { lines[curLine] += str; scheduleDraw() }
        return
      }

      if (key.ctrl && key.name === 'c') {
        if (drawPending) { drawPending = false; draw() }
        process.stdout.write(`\x1b[${drawnLines - 1 - curLine}B\n`)
        process.stdin.removeListener('keypress', onKey)
        if (process.stdin.isTTY) process.stdin.setRawMode(false)
        resolve(null)  // null = 終了シグナル（メインループで後処理）
      }

      if (key.name === 'return') {
        // Alt+Enter（macOS: Option+Enter）または Shift+Enter → 改行
        if (key.meta || key.shift) {
          lines.splice(curLine + 1, 0, '')
          curLine++
          scheduleDraw()
        } else {
          // Enter → 送信（保留中の描画があれば先に確定）
          if (drawPending) { drawPending = false; draw() }
          const content = lines.join('\n').trim()
          if (!content) return
          process.stdout.write(`\x1b[${drawnLines - 1 - curLine}B\n`)
          process.stdin.removeListener('keypress', onKey)
          if (process.stdin.isTTY) process.stdin.setRawMode(false)
          resolve(content)
        }
        return
      }

      if (key.name === 'backspace') {
        if (lines[curLine].length > 0) {
          lines[curLine] = lines[curLine].slice(0, -1)
          scheduleDraw()
        } else if (curLine > 0) {
          lines.splice(curLine, 1)
          curLine--
          scheduleDraw()
        }
        return
      }

      if (str && !key.ctrl && !key.meta) {
        lines[curLine] += str
        scheduleDraw()
      }
    }

    process.stdin.on('keypress', onKey)
  })
}

// ---- セッション終了（サマリー保存 → 挨拶 → exit） ----
async function gracefulExit() {
  const saved = await agent.saveSummary(cwd)
  if (saved) {
    console.log(chalk.dim(`\n  セッションを記録しました → ${saved}`))
  }
  console.log(chalk.cyan(`\n  お疲れ様でした！またね。\n`))
  process.exit(0)
}

// ---- メインループ ----
async function prompt() {
  // 入力ボックス上辺（ユーザー名をセパレーターに埋め込む）
  console.log('\n' + sepWithLabel(chalk.bold.cyan(userName || 'あなた')))

  const rawInput = await readChatInput()
  if (rawInput === null) return gracefulExit()  // Ctrl+C
  const input = rawInput.trim()
  if (!input) return prompt()

  // --- ビルトインコマンド ---
  if (input === '/exit' || input === '/quit') {
    return gracefulExit()
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
        await agent.chat(expanded)
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
    await agent.chat(input)
  } catch (err) {
    console.error(chalk.red('\n  エラー: ' + err.message + '\n'))
  }

  prompt()
}

prompt()
