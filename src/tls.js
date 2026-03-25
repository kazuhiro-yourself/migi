import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import https from 'https'
import tls from 'tls'

// .migi/ ディレクトリ内の .crt / .pem を名前不問でスキャン
function scanDir(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => ['.crt', '.pem'].includes(extname(f).toLowerCase()))
      .map(f => join(dir, f))
  } catch {
    return []
  }
}

function findCA() {
  // 優先順: 環境変数 → カレント.migi/ → カレント直下 → ホーム.migi/ → ホーム直下
  const candidates = [
    process.env.NODE_EXTRA_CA_CERTS,
    ...scanDir(join(process.cwd(), '.migi')),
    ...scanDir(process.cwd()),
    ...scanDir(join(homedir(), '.migi')),
    ...scanDir(homedir()),
  ].filter(Boolean)

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export const caPath = findCA()

let _httpsAgent = null

if (caPath) {
  const caCert = readFileSync(caPath)

  // ① tls.createSecureContext パッチ
  //    Node 18+ built-in fetch (undici) を含む全TLS接続に効く
  //    デフォルトのCA（tls.rootCertificates）に追加する形にする
  const _origCreate = tls.createSecureContext
  tls.createSecureContext = (options = {}) => {
    const base = options.ca
      ? (Array.isArray(options.ca) ? options.ca : [options.ca])
      : tls.rootCertificates   // デフォルトCAを引き継ぐ
    return _origCreate({ ...options, ca: [...base, caCert] })
  }

  // ② NODE_EXTRA_CA_CERTS（環境変数で起動する場合のフォールバック）
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = caPath
  }

  // ③ https.Agent: デフォルトCA + Zscaler CA を合わせて渡す
  _httpsAgent = new https.Agent({ ca: [...tls.rootCertificates, caCert] })

  console.log(`  [TLS] CA loaded: ${caPath}`)
} else {
  console.log('  [TLS] CA未設定 (社内エラー時は ~/.migi/ か ~/ に .crt/.pem を配置)')
}

export const httpsAgent = _httpsAgent
