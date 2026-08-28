import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.isSea
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')

function loadEnv() {
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnv()

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in print-agent/.env`)
  return value
}

export const config = Object.freeze({
  backendUrl: required('BACKEND_URL').replace(/\/$/, ''),
  agentId: required('AGENT_ID'),
  agentToken: required('AGENT_TOKEN'),
  cutEnabled: /^(1|true|yes)$/i.test(process.env.CUT_ENABLED || 'false'),
  cutCommandHex: process.env.CUT_COMMAND_HEX || '1D5600',
  cutFeedHex: process.env.CUT_FEED_HEX || '1B6403',
  longPollWaitMs: Number(process.env.LONG_POLL_WAIT_MS || 25000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
})
