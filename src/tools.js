import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { dirname, extname } from 'path'
import { request } from 'https'
import { glob } from 'glob'
import xlsxPkg from 'xlsx'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
import AdmZip from 'adm-zip'
import OpenAI from 'openai'
import { httpsAgent } from './tls.js'
const { readFile: xlsxReadFile, utils: xlsxUtils } = xlsxPkg

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const OFFICE_EXTS = new Set(['.pdf', '.pptx', '.ppt', '.docx', '.doc', '.odp', '.odt'])
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }

// ---- OpenAI ツールスキーマ定義 ----

export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'ファイルの内容を読み込む。テキスト・Excel・PDF・Word・PowerPoint・画像に対応',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルパス（絶対パスまたは相対パス）' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'ファイルに内容を書き込む（新規作成または上書き）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルパス' },
          content: { type: 'string', description: '書き込む内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_file',
      description: 'ファイルの末尾に内容を追記する',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルパス' },
          content: { type: 'string', description: '追記する内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'シェルコマンドを実行する',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '実行するコマンド' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'globパターンでファイルを一覧表示する',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'globパターン（例: **/*.md）' },
          cwd: { type: 'string', description: '検索ベースディレクトリ（省略時はカレントディレクトリ）' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: 'ファイル内容をキーワードで検索する',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '検索パターン（正規表現可）' },
          path: { type: 'string', description: '検索対象のファイルまたはディレクトリ' }
        },
        required: ['pattern', 'path']
      }
    }
  }
]

// ---- Teams 通知ツールスキーマ（Webhook URL が設定済みの場合のみ使用） ----

export const teamsToolSchema = {
  type: 'function',
  function: {
    name: 'notify_teams',
    description: 'Microsoft Teams のチャンネルに通知を送る。改善要望・不具合報告・重要な共有事項があるときに使う。',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '送信するメッセージ' }
      },
      required: ['message']
    }
  }
}

// ---- ツール実行 ----

export async function executeTool(name, args, opts = {}) {
  switch (name) {
    case 'read_file': {
      if (!existsSync(args.path)) return `エラー: ファイルが見つかりません: ${args.path}`
      const ext = extname(args.path).toLowerCase()

      // Excel
      if (ext === '.xlsx' || ext === '.xls') {
        const workbook = xlsxReadFile(args.path)
        const result = []
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName]
          const csv = xlsxUtils.sheet_to_csv(sheet)
          result.push(`## シート: ${sheetName}\n${csv}`)
        }
        return result.join('\n\n')
      }

      // PDF
      if (ext === '.pdf') {
        try {
          const buf = readFileSync(args.path)
          const data = await pdfParse(buf)
          return data.text?.trim() || '(テキストが抽出できませんでした)'
        } catch (err) {
          return `エラー: PDFの解析に失敗しました: ${err.message}`
        }
      }

      // PowerPoint（PPTX）/ Word（DOCX）→ ZIPを展開してXMLからテキスト抽出
      if (['.pptx', '.ppt', '.docx', '.doc', '.odp', '.odt'].includes(ext)) {
        try {
          const zip = new AdmZip(args.path)
          const entries = zip.getEntries()
          const xmlTexts = []
          for (const entry of entries) {
            const name = entry.entryName
            const isSlide = name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
            const isDoc = name === 'word/document.xml'
            const isOdp = name === 'content.xml'
            if (isSlide || isDoc || isOdp) {
              const xml = entry.getData().toString('utf-8')
              const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              if (text) xmlTexts.push(text)
            }
          }
          return xmlTexts.join('\n\n') || '(テキストが抽出できませんでした)'
        } catch (err) {
          return `エラー: ファイルの解析に失敗しました: ${err.message}`
        }
      }

      // 画像 → Vision API で内容を説明させる
      if (IMAGE_EXTS.has(ext)) {
        if (!opts.apiKey) return 'エラー: 画像読み込みにはAPIキーが必要です'
        const base64 = readFileSync(args.path).toString('base64')
        const mimeType = MIME[ext] || 'image/jpeg'
        const client = new OpenAI({
          apiKey: opts.apiKey,
          ...(httpsAgent ? { httpAgent: httpsAgent } : {})
        })
        const res = await client.chat.completions.create({
          model: opts.model || 'gpt-4.1-2025-04-14',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: 'この画像の内容を詳しく説明してください。テキストが含まれている場合はすべて書き起こしてください。' }
            ]
          }],
          max_tokens: 2000
        })
        return res.choices[0].message.content
      }

      return readFileSync(args.path, 'utf-8')
    }

    case 'write_file': {
      const dir = dirname(args.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(args.path, args.content, 'utf-8')
      return `完了: ${args.path} に書き込みました`
    }

    case 'append_file': {
      const dir = dirname(args.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(args.path, args.content, 'utf-8')
      return `完了: ${args.path} に追記しました`
    }

    case 'execute_command': {
      try {
        const output = execSync(args.command, { encoding: 'utf-8', timeout: 30000 })
        return output.trim() || '(出力なし)'
      } catch (err) {
        return `エラー: ${err.message}`
      }
    }

    case 'list_files': {
      const files = await glob(args.pattern, { cwd: args.cwd || process.cwd(), dot: true })
      return files.length > 0 ? files.join('\n') : '(ファイルが見つかりませんでした)'
    }

    case 'search_content': {
      try {
        const output = execSync(
          `grep -r ${JSON.stringify(args.pattern)} ${JSON.stringify(args.path)} --include="*.md" --include="*.txt" --include="*.js" --include="*.ts" -l 2>/dev/null`,
          { encoding: 'utf-8' }
        )
        return output.trim() || '(マッチなし)'
      } catch {
        return '(マッチなし)'
      }
    }

    case 'notify_teams': {
      const url = opts.teamsWebhookUrl
      if (!url) return 'エラー: Teams Webhook URL が設定されていません'
      const body = JSON.stringify({ text: args.message })
      return new Promise((resolve) => {
        const parsed = new URL(url)
        const options = {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          ...(httpsAgent ? { agent: httpsAgent } : {})
        }
        const req = request(options, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve('Teams に通知しました')
          } else {
            resolve(`エラー: Teams への送信に失敗しました (${res.statusCode})`)
          }
        })
        req.on('error', (err) => resolve(`エラー: ${err.message}`))
        req.write(body)
        req.end()
      })
    }

    default:
      return `不明なツール: ${name}`
  }
}
