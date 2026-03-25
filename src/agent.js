import OpenAI from 'openai'
import chalk from 'chalk'
import { homedir } from 'os'
import { toolSchemas, executeTool } from './tools.js'
import { createPermissionChecker } from './permissions.js'

export class MigiAgent {
  constructor({ context = '', promptFn = null, apiKey = null, model = 'gpt-4o', name = 'Migi' } = {}) {
    this.client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY })
    this.model = model
    this.history = []
    this.checkPermission = createPermissionChecker(promptFn || (() => Promise.resolve('y')))

    const cwd = process.cwd()
    const BASE_SYSTEM_PROMPT = `\
あなたの名前は「${name}」です。ユーザーがつけてくれた名前です。
自己紹介や会話の中で、この名前を自分の名前として使ってください。

あなたはユーザーの右腕として動くAIエージェントです。
仕事も人生も、何でも一緒に動きます。
ファイルの読み書き・コマンド実行・情報整理・壁打ち・タスク管理、何でもこなします。

## 口調
- 丁寧だが堅すぎない。「〜ですね！」「承知しました」「いいですね！」
- 主体的に提案する。「ついでにこれもやっておきましょうか？」
- 壁打ちのときはカジュアルに寄り添う

## メモリ
- ユーザーが「覚えておいて」「記録して」「remember」と言ったら、必ず memory.md に書き出す
- グローバルメモリ: ${homedir()}/.migi/memory.md（どのワークスペースでも使う情報）
- ワークスペースメモリ: ${cwd}/.migi/memory.md（このプロジェクト固有の情報）
- 迷ったらグローバルメモリに書く
- 形式: `## YYYY-MM-DD\n- 内容`
- 既存ファイルがあれば追記、なければ新規作成
- 重要な意思決定・学び・好みは言われなくても「記録しておきましょうか？」と提案する

## 環境
- 今日の日付: ${new Date().toISOString().split('T')[0]}
- カレントディレクトリ: ${cwd}
- ファイルパスは必ずこのディレクトリを基準に構築すること
- 相対パスは使わず、常に絶対パスでツールを呼び出すこと
`
    this.systemPrompt = BASE_SYSTEM_PROMPT +
      (context ? `\n## ロードされたコンテキスト\n${context}` : '')
  }

  async chat(userMessage) {
    this.history.push({ role: 'user', content: userMessage })

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.history
    ]

    while (true) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: toolSchemas,
        tool_choice: 'auto'
      })

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

          console.log(chalk.dim(`\n  [${name}]`))

          const approved = await this.checkPermission(name, args)
          let result

          if (approved) {
            result = await executeTool(name, args)
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
