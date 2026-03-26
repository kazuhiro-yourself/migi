import OpenAI from 'openai'
import chalk from 'chalk'
import { homedir } from 'os'
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

## メモリ
- ユーザーが「覚えておいて」「記録して」「remember」と言ったら、必ず memory.md に書き出す
- グローバルメモリ: ${homedir()}/.migi/memory.md（どのワークスペースでも使う情報）
- ワークスペースメモリ: ${cwd}/.migi/memory.md（このプロジェクト固有の情報）
- 迷ったらグローバルメモリに書く
- 形式: "## YYYY-MM-DD" の見出しの下に箇条書きで記録
- 既存ファイルがあれば追記、なければ新規作成
- 重要な意思決定・学び・好みは言われなくても「記録しておきましょうか？」と提案する

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
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools,
        tool_choice: 'auto'
      })
      spinner.stop()

      const choice = response.choices[0]
      messages.push(choice.message)
      this.history.push(choice.message)

      // 通常の返答
      if (choice.finish_reason === 'stop') {
        return choice.message.content
      }

      // ツール呼び出し
      if (choice.finish_reason === 'tool_calls') {
        const toolResults = []

        for (const toolCall of choice.message.tool_calls) {
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
