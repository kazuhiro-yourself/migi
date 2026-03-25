import chalk from 'chalk'

// これらは確認なしで自動実行
const AUTO_APPROVED = new Set(['read_file', 'list_files', 'search_content'])

/**
 * promptFn: (question: string) => Promise<string>
 * bin/migi.js から readline の question 関数を受け取る
 */
export function createPermissionChecker(promptFn) {
  return async function checkPermission(toolName, args) {
    if (AUTO_APPROVED.has(toolName)) return true

    console.log(chalk.yellow('\n  ⚡ 実行確認'))
    console.log(chalk.dim(`  ツール : ${toolName}`))
    if (args.path)    console.log(chalk.dim(`  パス   : ${args.path}`))
    if (args.command) console.log(chalk.dim(`  コマンド: ${args.command}`))

    const answer = await promptFn(chalk.yellow('  実行しますか？ [y/N] '))
    return answer.trim().toLowerCase() === 'y'
  }
}
