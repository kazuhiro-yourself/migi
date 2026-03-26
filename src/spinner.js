import chalk from 'chalk'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
  constructor() {
    this._frame = 0
    this._timer = null
    this._text = ''
  }

  start(text = '考え中…') {
    this._text = text
    this._frame = 0
    this._timer = setInterval(() => {
      const icon = chalk.cyan(FRAMES[this._frame % FRAMES.length])
      process.stdout.write(`\r  ${icon} ${chalk.dim(this._text)}   `)
      this._frame++
    }, 80)
  }

  update(text) {
    this._text = text
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
      // 行をクリア
      process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80)) + '\r')
    }
  }
}
