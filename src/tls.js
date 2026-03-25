import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import https from 'https'

// CA ファイルの検索順（単体 .crt / bundle.pem どちらでも可）
const CA_CANDIDATES = [
  process.env.NODE_EXTRA_CA_CERTS,                       // 環境変数で明示指定
  join(homedir(), '.migi', 'zscaler-ca.pem'),            // Zscaler 推奨パス
  join(homedir(), '.migi', 'zscaler-ca.crt'),            // .crt 形式でも OK
  join(homedir(), '.migi', 'ca-bundle.pem'),             // 複数CA連結 bundle
].filter(Boolean)

function findCA() {
  for (const p of CA_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return null
}

export const caPath = findCA()

// NODE_EXTRA_CA_CERTS: Node 18+ built-in fetch / undici 向け
if (caPath && !process.env.NODE_EXTRA_CA_CERTS) {
  process.env.NODE_EXTRA_CA_CERTS = caPath
}

// https.Agent: openai SDK の httpAgent オプション向け
export const httpsAgent = caPath
  ? new https.Agent({ ca: readFileSync(caPath) })
  : null
