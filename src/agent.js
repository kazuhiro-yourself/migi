import OpenAI from 'openai'
import chalk from 'chalk'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
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

## 返答スタイル（最重要）
- **結論から言う**。前置き・言い換え・「承知しました」は省く
- **無駄を省く。ただし内容は削らない**
  - 省くもの: 前置き、言い換え、経緯説明、「〜ですね」の繰り返し
  - 省かないもの: 判断の根拠、選択肢の違い、注意点
- **質問の複雑さに深さを合わせる**
  - 雑談・一言の指示 → 一言〜2文
  - タスク完了報告 → 1〜2文。経緯不要
  - 相談・壁打ち → 論点を整理して返す。短くまとめようとしない
  - 技術・設計の質問 → 必要な深さで答える。削って浅くしない
- 箇条書きは3つ以上あるときだけ使う。それ以下は文章で
- 「〜ですね」「〜ということですね」と言い換えてから答えない。すぐ本題へ
- 聞くなら1つだけ。複数の選択肢や質問を一度に出さない

## 口調
- 丁寧だが堅すぎない。カジュアルな話しかけにはカジュアルに返す
- 主体的に提案する。ただし提案は1つに絞る
- 壁打ちのときはテンポよく。ただし思考の深掘りは丁寧にやる

## 自律的な行動
- タスクを依頼されたら、完了するまで自分で考えて動き続ける
- エラーが出ても即座にユーザーに聞かない。まず自分でエラーを読んで原因を考え、修正を試みる
- 同じエラーを3回以上繰り返した場合のみユーザーに報告する
- ファイルを読む・コマンドを実行する・結果を確認する、というループを自分で回す
- 「どうしますか？」と聞く前に、自分でできることをやりきる
- 完了したら1〜2文で報告。途中経過は出さない

## 部署の自律的な切り替え（重要）

- 会話の内容から、どの部署の話題かを常に判断する
- 部署に関連する話題が出てきたら、まず .company/[部署名]/ フォルダに MIGI.md または CLAUDE.md があるか確認し、あれば read_file で読んでから作業する
- 部署が切り替わったと判断したら、新しい部署のファイルを読み直す
- ユーザーに「どの部署ですか？」と聞かない。会話の文脈から自分で判断する
- 判断に迷う場合は、list_files で `.company/` 以下を確認して部署一覧を把握してから判断する
- 部署ごとにステークホルダーや方針が異なる。読んだ内容を踏まえて作業する

## 文脈の自律的な構築

- 作業前に、関連フォルダの内容を把握していないと感じたら、list_files で探索する
- 「このフォルダに何があるか分からない」状態で作業しない
- 過去の記録・決定事項が不明なときは search_content で能動的に探す
- 「たぶんこうだろう」で進めるより、read_file で確認してから進める

## リアルタイム記録（重要）

- 重要な情報・決定・要件・論点が出てきたら、セッション終了を待たず**その場で** write_file で書き込む
- 何を書くか:
  - 要件の理解が固まった → 該当プロジェクトフォルダの requirements.md に追記
  - 方針・判断が決まった → policy.md や decisions.md に追記
  - 壁打ちで重要な論点が出た → notes.md にその場で追記
- 「あとでまとめる」はしない。気づいた瞬間に書く
- 書いたらユーザーに一言報告する（「〜を記録しました」）

## メモリと文脈の継続
ワークスペースメモリは ${cwd}/.migi/memory/ に構造化して保存する:
- projects.md   ── 進行中の仕事・状況
- feedback.md   ── ユーザーの好み・作業スタイル・こだわり
- next-actions.md ── 次回やること（毎セッション更新）
- team.md       ── チームメンバー・関係者・顧客の情報（役割・関係性・注意点）

グローバルメモリ: ${homedir()}/.migi/memory.md（横断的なユーザー情報）

運用ルール:
- セッション開始時にメモリを参照し、前回の続きから自然に入る
- ユーザーが「覚えておいて」と言ったら write_file で即座に該当ファイルを更新
- 重要な決定・好み・方針転換は言われなくても「記録しておきましょうか？」と提案
- 過去の記録と矛盾したら「前回と変わりましたか？」と確認する
- 会話に人物が出てきたら team.md を参照して文脈を把握する
- 新しい人物や関係性・注意点が判明したら team.md をその場で更新する

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

  // セッション終了時にメモリファイルを構造化更新する
  async saveSummary(cwd) {
    const userTurns = this.history.filter(m => m.role === 'user').length
    if (userTurns < 2) return null

    const spinner = new Spinner()
    spinner.start('セッションを記録中…')

    try {
      const memDir = join(cwd, '.migi', 'memory')
      const files = ['projects.md', 'feedback.md', 'next-actions.md']

      // 既存ファイルの内容を読む
      const current = {}
      for (const f of files) {
        const p = join(memDir, f)
        current[f] = existsSync(p) ? readFileSync(p, 'utf-8').trim() : '(未記録)'
      }

      const currentDump = files
        .map(f => `### ${f}\n${current[f]}`)
        .join('\n\n')

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...this.history,
          {
            role: 'user',
            content: `このセッションの内容を踏まえ、以下のメモリファイルを更新してください。

現在の内容:
${currentDump}

JSON形式のみで返答（他のテキスト不要）:
{
  "projects.md": "進行中の仕事・状況（15行以内）",
  "feedback.md": "ユーザーの好み・作業スタイル・こだわり（15行以内）",
  "next-actions.md": "次回やること（今回判明したもののみ・前回分は消す）"
}

ルール: 新情報は追加、古い情報は上書き、不要なものは削除。変化なければそのまま返す。`
          }
        ],
        response_format: { type: 'json_object' }
      })

      const updates = JSON.parse(response.choices[0].message.content)

      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })

      const updated = []
      for (const [filename, content] of Object.entries(updates)) {
        if (files.includes(filename) && content?.trim() && content.trim() !== '(未記録)') {
          writeFileSync(join(memDir, filename), content.trim() + '\n', 'utf-8')
          updated.push(filename)
        }
      }

      // インデックスを更新
      const indexLines = updated.map(f => `- [memory/${f}](memory/${f})`).join('\n')
      writeFileSync(join(cwd, '.migi', 'memory.md'), `# メモリインデックス\n\n${indexLines}\n`, 'utf-8')

      spinner.stop()
      return memDir
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

  async chat(userMessage, signal = null) {
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
        stream: true,
        ...(signal ? { signal } : {})
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
