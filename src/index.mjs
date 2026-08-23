import { claimJob, completeJob, failJob } from './backend-client.mjs'
import { config } from './config.mjs'
import { printText } from './transports/windows-spooler.mjs'

let stopping = false

function log(message, error) {
  const suffix = error ? ` ${error instanceof Error ? error.message : String(error)}` : ''
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`)
}

async function processNextJob() {
  const job = await claimJob()
  if (!job) return false

  log(`Printing job ${job._id || job.id}`)
  try {
    await printText(job.payload?.printableText || '')
    await completeJob(job._id || job.id)
    log(`Printed job ${job._id || job.id}`)
  } catch (error) {
    log(`Print failed for job ${job._id || job.id}`, error)
    await failJob(job._id || job.id, error).catch((failError) => log('Could not report failed print job', failError))
  }
  return true
}

async function run() {
  log(`MamMi Print Agent started for ${config.agentId}`)
  while (!stopping) {
    try {
      const processed = await processNextJob()
      if (!processed) await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
    } catch (error) {
      log('Backend connection failed; retrying', error)
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    log(`Received ${signal}; stopping`)
  })
}

run().catch((error) => {
  log('Agent stopped unexpectedly', error)
  process.exitCode = 1
})
