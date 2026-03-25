import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import https from 'https'
import tls from 'tls'

// CA ファイルの検索順（単体 .crt / bundle.pem どちらでも可）
const CA_CANDIDATES = [
  process.env.NODE_EXTRA_CA_CERTS,
  join(homedir(), '.migi', 'zscaler-ca.pem'),
  join(homedir(), '.migi', 'zscaler-ca.crt'),
  join(homedir(), '.migi', 'ca-bundle.pem'),
].filter(Boolean)

function findCA() {
  for (const p of CA_CANDIDATES) {
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
  const _origCreate = tls.createSecureContext
  tls.createSecureContext = (options = {}) => {
    const extra = [caCert]
    const existing = options.ca
      ? (Array.isArray(options.ca) ? options.ca : [options.ca])
      : []
    return _origCreate({ ...options, ca: [...existing, ...extra] })
  }

  // ② NODE_EXTRA_CA_CERTS（環境変数で起動する場合のフォールバック）
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = caPath
  }

  // ③ https.Agent（node-fetch 系フォールバック）
  _httpsAgent = new https.Agent({ ca: caCert })

  console.log(`  [TLS] CA loaded: ${caPath}`)
} else {
  console.log('  [TLS] CA未設定 (社内エラー時は ~/.migi/zscaler-ca.pem を配置)')
}

export const httpsAgent = _httpsAgent
