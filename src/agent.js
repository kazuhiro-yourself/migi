import OpenAI from 'openai'
import chalk from 'chalk'
import { homedir } from 'os'
import { existsSync, appendFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { toolSchemas, teamsToolSchema, executeTool } from './tools.js'
import { createPermissionChecker } from './permissions.js'
import { httpsAgent } from './tls.js'
import { Spinner } from './spinner.js'

export class MigiAgent {
  constructor({ context = '', promptFn = null, apiKey = null, model = 'gpt-4.1-2025-04-14', name = 'Migi', userName = '', teamsWebhookUrl = '' } = {}) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY
    this.client = new OpenAI({
      apiKey: this.apiKey,
      ...(httpsAgent ? { httpAgent: httpsAgent } : {})
    })
    this.model = model
    this.history = []
    this.teamsWebhookUrl = teamsWebhookUrl
    this.tools = teamsWebhookUrl ? [...toolSchemas, teamsToolSchema] : toolSchemas
    this.checkPermission = createPermissionChecker(promptFn || (() => Promise.resolve('y')))

    const cwd = process.cwd()
    const userNameLine = userName
      ? `ユーザーの名前は「${userName}」です。会話の中でこの名前で呼んでください。「さん」などの敬称は不要です。`
      : ''
    const BASE_SYSTEM_PROMPT = `\
あなたの名前は「${name}」です。ユーザーがつけてくれた名前です。
自己紹介や会話の中で、この名前を自分の名前として使ってください。
${userNameLine}

あなたはユーザーの右腕として動くAIエージェントです。
仕事も人生も、何でも一緒に動きます。
ファイルの読み書き・コマンド実行・情報整理・壁打ち・タスク管理、何でもこなします。

## 口調
- 丁寧だが堅すぎない。「〜ですね！」「承知しました」「いいですね！」
- 主体的に提案する。「ついでにこれもやっておきましょうか？」
- 壁打ちのときはカジュアルに寄り添う

## 自律的な行動
- タスクを依頼されたら、完了するまで自分で考えて動き続ける
- エラーが出ても即座にユーザーに聞かない。まず自分でエラーを読んで原因を考え、修正を試みる
- 同じエラーを3回以上繰り返した場合のみユーザーに報告する
- ファイルを読む・コマンドを実行する・結果を確認する、というループを自分で回す
- 「どうしますか？」と聞く前に、自分でできることをやりきる
- 完了したらまとめて報告する。途中経過は簡潔に

## メモリと文脈の継続
- グローバルメモリ: ${homedir()}/.migi/memory.md（ユーザーの好み・習慣・横断的な情報）
- ワークスペースメモリ: ${cwd}/.migi/memory.md（このプロジェクト固有の情報・決定事項）
- 形式: "## YYYY-MM-DD" の見出しの下に箇条書きで記録。既存ファイルがあれば追記
- ユーザーが「覚えておいて」「remember」と言ったら必ず書き出す
- 言われなくても、以下は自発的に記録する:
  - 重要な意思決定・方針転換
  - ユーザーの好み・こだわり・やり方のクセ
  - 繰り返し登場するテーマやプロジェクト
  - 「次回やること」として明確になったタスク
- セッション開始時にメモリの内容を参照し、前回の続きから自然に入る
- 過去の記録と矛盾することをユーザーが言ったら「前回と変わりましたか？」と確認する

## 環境
- 今日の日付: ${new Date().toISOString().split('T')[0]}
- カレントディレクトリ: ${cwd}
- ファイルパスは必ずこのディレクトリを基準に構築すること
- 相対パスは使わず、常に絶対パスでツールを呼び出すこと
`
    const teamsPrompt = teamsWebhookUrl
      ? `\n## Teams通知\n- 改善要望・不具合報告・重要な共有事項があれば notify_teams ツールでTeamsに通知する\n- ユーザーが「改善要望」「フィードバック」「不具合」「共有して」などと言ったら、内容をまとめてTeamsに通知することを提案する`
      : ''
    this.systemPrompt = BASE_SYSTEM_PROMPT + teamsPrompt +
      (context ? `\n## ロードされたコンテキスト\n${context}` : '')
  }

  // セッションの会話をサマリーして memory.md に保存する
  async saveSummary(cwd) {
    // ユーザー発言が2回未満なら保存しない（短すぎるセッション）
    const userTurns = this.history.filter(m => m.role === 'user').length
    if (userTurns < 2) return null

    const spinner = new Spinner()
    spinner.start('セッションを記録中…')

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...this.history,
          {
            role: 'user',
            content: `このセッションを次回の文脈引き継ぎ用に要約してください。
以下の形式で箇条書き3〜6行。日本語で簡潔に（1行50字以内）。

- 話し合ったこと・決定したこと
- 完了したこと・作ったもの
- ユーザーについて学んだこと（好み・やり方など）
- 次回やること（あれば）

形式:「- 〜」の箇条書きのみ。見出しや前置きは不要。`
          }
        ]
      })

      const summary = response.choices[0].message.content.trim()
      const today = new Date().toISOString().split('T')[0]
      const entry = `\n## ${today}\n${summary}\n`

      const memPath = join(cwd, '.migi', 'memory.md')
      const dir = dirname(memPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(memPath, entry, 'utf-8')

      spinner.stop()
      return memPath
    } catch (err) {
      spinner.stop()
      return null
    }
  }

  // tool_calls に対応する tool 結果がない壊れた履歴を修復する
  _sanitizeHistory() {
    const cleaned = []
    for (let i = 0; i < this.history.length; i++) {
      const msg = this.history[i]
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const toolIds = msg.tool_calls.map(t => t.id)
        const hasAllResults = toolIds.every(id =>
          this.history.slice(i + 1).some(m => m.role === 'tool' && m.tool_call_id === id)
        )
        if (!hasAllResults) continue  // 対応する結果がなければ丸ごとスキップ
      }
      cleaned.push(msg)
    }
    this.history = cleaned
  }

  async chat(userMessage) {
    this._sanitizeHistory()
    this.history.push({ role: 'user', content: userMessage })

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.history
    ]

    const spinner = new Spinner()

    while (true) {
      spinner.start('考え中…')

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools,
        tool_choice: 'auto',
        stream: true
      })

      let content = ''
      const tcMap = {}   // tool_calls をインデックスで蓄積
      let finishReason = null
      let streaming = false  // 最初のコンテンツが届いたか

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue
        const delta = choice.delta
        if (choice.finish_reason) finishReason = choice.finish_reason

        // テキストチャンク
        if (delta?.content) {
          if (!streaming) {
            spinner.stop()
            process.stdout.write('\n')
            streaming = true
          }
          content += delta.content
          process.stdout.write(delta.content)
        }

        // tool_calls チャンク（引数はストリームで分割されて届く）
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!tcMap[tc.index]) tcMap[tc.index] = { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (tc.id) tcMap[tc.index].id += tc.id
            if (tc.function?.name) tcMap[tc.index].function.name += tc.function.name
            if (tc.function?.arguments) tcMap[tc.index].function.arguments += tc.function.arguments
          }
        }
      }

      spinner.stop()

      // 通常の返答
      if (finishReason === 'stop') {
        process.stdout.write('\n\n')
        const assistantMsg = { role: 'assistant', content }
        messages.push(assistantMsg)
        this.history.push(assistantMsg)
        return content
      }

      // ツール呼び出し
      if (finishReason === 'tool_calls') {
        if (streaming) process.stdout.write('\n')
        const toolCalls = Object.values(tcMap)
        const assistantMsg = { role: 'assistant', content: content || null, tool_calls: toolCalls }
        messages.push(assistantMsg)
        this.history.push(assistantMsg)

        const toolResults = []
        for (const toolCall of toolCalls) {
          const args = JSON.parse(toolCall.function.arguments)
          const name = toolCall.function.name

          console.log(chalk.dim(`  ⚙ ${name}`))

          const approved = await this.checkPermission(name, args)
          let result

          if (approved) {
            spinner.start(`実行中: ${name}`)
            try {
              result = await executeTool(name, args, {
                teamsWebhookUrl: this.teamsWebhookUrl,
                apiKey: this.apiKey,
                model: this.model
              })
            } catch (err) {
              result = `エラー: ${err.message}`
            }
            spinner.stop()
          } else {
            result = 'ユーザーによりキャンセルされました'
            console.log(chalk.dim('  → キャンセル'))
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: String(result)
          })
        }

        messages.push(...toolResults)
        this.history.push(...toolResults)
      }
    }
  }
}
