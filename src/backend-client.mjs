import { config } from './config.mjs'

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const response = await fetch(`${config.backendUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-agent-id': config.agentId,
        'x-agent-token': config.agentToken,
        'x-store-id': config.storeId,
        ...(options.headers || {}),
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${response.status}: ${body.message || 'Backend request failed'}`)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

export async function claimJob() {
  const response = await request('/api/print-agent/jobs/claim', { method: 'POST', body: '{}' })
  return response.data || null
}

export function completeJob(jobId) {
  return request(`/api/print-agent/jobs/${encodeURIComponent(jobId)}/complete`, { method: 'POST', body: '{}' })
}

export function failJob(jobId, error) {
  return request(`/api/print-agent/jobs/${encodeURIComponent(jobId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({ error: String(error).slice(0, 1000) }),
  })
}
