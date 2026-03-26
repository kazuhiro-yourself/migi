import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { dirname, extname } from 'path'
import { diffLines } from 'diff'
import { request } from 'https'
import { glob } from 'glob'
import chalk from 'chalk'
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

// ---- PDFから埋め込み画像を抽出（ネイティブ依存なし） ----

function extractImagesFromPdf(buf) {
  const images = []
  let i = 0

  while (i < buf.length - 1) {
    // JPEG: FF D8 で始まり FF D9 で終わる
    if (buf[i] === 0xFF && buf[i + 1] === 0xD8) {
      const eoiIdx = buf.indexOf(Buffer.from([0xFF, 0xD9]), i + 2)
      if (eoiIdx === -1) break
      images.push({ data: buf.slice(i, eoiIdx + 2), mime: 'image/jpeg' })
      i = eoiIdx + 2
      continue
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A で始まる
    if (
      i + 7 < buf.length &&
      buf[i] === 0x89 && buf[i+1] === 0x50 && buf[i+2] === 0x4E && buf[i+3] === 0x47 &&
      buf[i+4] === 0x0D && buf[i+5] === 0x0A && buf[i+6] === 0x1A && buf[i+7] === 0x0A
    ) {
      const iend = buf.indexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]), i + 8)
      if (iend === -1) break
      images.push({ data: buf.slice(i, iend + 8), mime: 'image/png' })
      i = iend + 8
      continue
    }

    i++
  }

  return images
}

// ---- diff 表示 ----

function showDiff(path, oldContent, newContent) {
  const MAX_LINES = 50  // 長すぎる diff は省略

  if (oldContent === null) {
    console.log(chalk.green(`  + ${path} (新規作成)`))
    return
  }

  if (oldContent === newContent) {
    console.log(chalk.dim(`  = ${path} (変更なし)`))
    return
  }

  const parts = diffLines(oldContent, newContent)
  let shown = 0
  let truncated = false

  for (const part of parts) {
    if (!part.added && !part.removed) continue
    const lines = part.value.replace(/\n$/, '').split('\n')
    for (const line of lines) {
      if (shown >= MAX_LINES) { truncated = true; break }
      if (part.added)   console.log(chalk.green(`  + ${line}`))
      if (part.removed) console.log(chalk.red(`  - ${line}`))
      shown++
    }
    if (truncated) break
  }

  if (truncated) console.log(chalk.dim(`  … (省略)`))
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
        const buf = readFileSync(args.path)

        // Step 1: テキストPDFとして抽出を試みる
        try {
          const data = await pdfParse(buf)
          const text = data.text?.trim()
          if (text) return text
        } catch (_) {}

        // Step 2: 画像PDFとしてVision APIでOCR（ネイティブ依存なし）
        if (!opts.apiKey) return '(テキストが抽出できませんでした)'
        const images = extractImagesFromPdf(buf)
        if (images.length === 0) return '(テキストも画像も抽出できませんでした)'

        const client = new OpenAI({
          apiKey: opts.apiKey,
          ...(httpsAgent ? { httpAgent: httpsAgent } : {})
        })
        const targets = images.slice(0, 10)  // 最大10ページ
        const res = await client.chat.completions.create({
          model: opts.model || 'gpt-4.1-2025-04-14',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'このPDFのページ画像です。すべてのテキストを正確に書き起こしてください。' },
              ...targets.map(img => ({
                type: 'image_url',
                image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}` }
              }))
            ]
          }],
          max_tokens: 4000
        })
        return res.choices[0].message.content
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
      const oldContent = existsSync(args.path) ? readFileSync(args.path, 'utf-8') : null
      writeFileSync(args.path, args.content, 'utf-8')
      showDiff(args.path, oldContent, args.content)
      return `完了: ${args.path} に書き込みました`
    }

    case 'append_file': {
      const dir = dirname(args.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const base = existsSync(args.path) ? readFileSync(args.path, 'utf-8') : ''
      appendFileSync(args.path, args.content, 'utf-8')
      showDiff(args.path, base, base + args.content)
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
