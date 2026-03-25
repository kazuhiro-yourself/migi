import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * ワークスペースが未初期化かどうかを判定する
 */
export function isEmptyWorkspace(cwd = process.cwd()) {
  return (
    !existsSync(join(cwd, 'MIGI.md')) &&
    !existsSync(join(cwd, 'CLAUDE.md')) &&
    !existsSync(join(cwd, '.company'))
  )
}

/**
 * 対話型オンボーディングを実行してワークスペースを初期化する
 */
export async function runOnboarding(cwd, promptFn) {
  console.log(chalk.bold.cyan('\n  はじめまして！Migi があなたの右腕になります。'))
  console.log(chalk.dim('  まず、2つだけ教えてください。\n'))

  // Q1
  console.log(chalk.dim('  あなたの事業・活動を教えてください。'))
  console.log(chalk.dim('  例: 個人開発、フリーランス、副業、スタートアップ、本業+副業 など\n'))
  const businessType = await promptFn(chalk.white('  [1/2] > '))

  if (!businessType.trim()) {
    console.log(chalk.yellow('\n  入力がありませんでした。あとで /setup で再実行できます。\n'))
    return false
  }

  // Q2
  console.log(chalk.dim('\n  今の目標や、困っていることを教えてください。'))
  console.log(chalk.dim('  例: 月10万目指してる、タスクが散らかる、アイデアを忘れる\n'))
  const goals = await promptFn(chalk.white('  [2/2] > '))

  console.log(chalk.dim('\n  ── セットアップ中...\n'))

  // ファイル生成
  await generateWorkspace(cwd, businessType.trim(), goals.trim())

  // 完了メッセージ
  console.log(chalk.green('  セットアップ完了！\n'))
  console.log(chalk.dim('  .company/'))
  console.log(chalk.dim('  ├── MIGI.md'))
  console.log(chalk.dim('  └── secretary/'))
  console.log(chalk.dim('      ├── MIGI.md'))
  console.log(chalk.dim('      ├── inbox/'))
  console.log(chalk.dim('      └── notes/'))
  console.log(chalk.dim(`\n  todos/${today()}.md\n`))
  console.log(chalk.cyan('  何でも話しかけてください！\n'))
  console.log(chalk.dim('  ─────────────────────────────────\n'))

  return true
}

// ---- ワークスペース生成 ----

async function generateWorkspace(cwd, businessType, goals) {
  const date = today()

  // .company/MIGI.md
  const companyDir = join(cwd, '.company')
  mkdirSync(companyDir, { recursive: true })
  const companyMigi = buildCompanyMigi(businessType, goals, date)
  write(join(companyDir, 'MIGI.md'), companyMigi, '.company/MIGI.md')

  // .company/secretary/
  const secretaryDir = join(companyDir, 'secretary')
  mkdirSync(join(secretaryDir, 'inbox'), { recursive: true })
  mkdirSync(join(secretaryDir, 'notes'), { recursive: true })

  const secretaryMigi = readFileSync(join(PACKAGE_DIR, 'templates', 'secretary-migi.md'), 'utf-8')
  write(join(secretaryDir, 'MIGI.md'), secretaryMigi, '.company/secretary/MIGI.md')

  // todos/YYYY-MM-DD.md（.company の外）
  const todosDir = join(cwd, 'todos')
  mkdirSync(todosDir, { recursive: true })
  const todoPath = join(todosDir, `${date}.md`)
  if (!existsSync(todoPath)) {
    write(todoPath, buildTodayTodo(date), `todos/${date}.md`)
  }
}

function buildCompanyMigi(businessType, goals, date) {
  const personalizationNotes = buildPersonalizationNotes(businessType, goals)
  const template = readFileSync(join(PACKAGE_DIR, 'templates', 'company-migi.md'), 'utf-8')

  return template
    .replace('{{BUSINESS_TYPE}}', businessType)
    .replace('{{GOALS_AND_CHALLENGES}}', goals)
    .replace('{{CREATED_DATE}}', date)
    .replace('{{ADDITIONAL_DEPARTMENTS}}', '')
    .replace('{{DEPARTMENT_TABLE_ROWS}}', '')
    .replace('{{PERSONALIZATION_NOTES}}', personalizationNotes)
}

function buildPersonalizationNotes(businessType, goals) {
  const notes = []
  if (businessType) notes.push(`- 事業・活動: ${businessType}`)
  if (goals) notes.push(`- 目標・課題: ${goals}`)
  return notes.join('\n') || '（未設定）'
}

function buildTodayTodo(date) {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const d = new Date(date)
  const dow = weekdays[d.getDay()]
  return `---\ndate: "${date}"\ntype: daily\n---\n\n# ${date} (${dow})\n\n## TODO\n\n\n`
}

function write(path, content, label) {
  writeFileSync(path, content, 'utf-8')
  console.log(chalk.dim(`  ✓ ${label}`))
}

function today() {
  return new Date().toISOString().split('T')[0]
}
