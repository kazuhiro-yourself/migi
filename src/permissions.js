import chalk from 'chalk'

// これらは確認なしで自動実行
const AUTO_APPROVED = new Set(['read_file', 'list_files', 'search_content'])

/**
 * promptFn: (question: string) => Promise<string>
 * bin/migi.js から readline の question 関数を受け取る
 */
export function createPermissionChecker(promptFn) {
  let approveAll = false

  return async function checkPermission(toolName, args) {
    if (AUTO_APPROVED.has(toolName)) return true
    if (approveAll) {
      console.log(chalk.dim(`  [${toolName}] 自動承認`))
      return true
    }

    console.log(chalk.yellow('\n  ⚡ 実行確認'))
    console.log(chalk.dim(`  ツール : ${toolName}`))
    if (args.path)    console.log(chalk.dim(`  パス   : ${args.path}`))
    if (args.command) console.log(chalk.dim(`  コマンド: ${args.command}`))

    const answer = await promptFn(chalk.yellow('  実行しますか？ [y/a/N]  y=yes  a=以降すべてyes  N=no  > '))
    const input = answer.trim().toLowerCase()

    if (input === 'a') {
      approveAll = true
      console.log(chalk.green('  以降の操作をすべて自動承認します。'))
      return true
    }

    return input === 'y'
  }
}
