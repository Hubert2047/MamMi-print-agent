import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  storeId: required('STORE_ID'),
  printerName: required('PRINTER_NAME'),
  printMode: (process.env.PRINT_MODE || 'label').toLowerCase(),
  labelWidthMm: Number(process.env.LABEL_WIDTH_MM || 58),
  labelHeightMm: Number(process.env.LABEL_HEIGHT_MM || 40),
  labelGapMm: Number(process.env.LABEL_GAP_MM || 2),
  cutEnabled: /^(1|true|yes)$/i.test(process.env.CUT_ENABLED || 'false'),
  cutCommandHex: process.env.CUT_COMMAND_HEX || '1D5600',
  cutFeedHex: process.env.CUT_FEED_HEX || '1B6403',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 2000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
})
