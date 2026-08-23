import { claimJob, completeJob, failJob, getAgentConfig } from './backend-client.mjs'
import { config } from './config.mjs'
import { printText } from './transports/windows-spooler.mjs'

let stopping = false
let printers = new Map()

function log(message, error) {
  const suffix = error ? ` ${error instanceof Error ? error.message : String(error)}` : ''
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`)
}

async function processNextJob() {
  const job = await claimJob()
  if (!job) return false

  log(`Printing job ${job._id || job.id}`)
  try {
    let printer = printers.get(String(job.printerId))
    if (!printer) {
      await refreshPrinters()
      printer = printers.get(String(job.printerId))
    }
    if (!printer) throw new Error(`Printer configuration not found for ${job.printerId}`)
    await printText(job.payload?.printableText || '', printer)
    await completeJob(job._id || job.id)
    log(`Printed job ${job._id || job.id}`)
  } catch (error) {
    log(`Print failed for job ${job._id || job.id}`, error)
    await failJob(job._id || job.id, error).catch((failError) => log('Could not report failed print job', failError))
  }
  return true
}

async function refreshPrinters() {
  const agentConfig = await getAgentConfig()
  printers = new Map((agentConfig?.printers || []).map((printer) => [String(printer._id), printer]))
}

async function run() {
  await refreshPrinters()
  log(`MamMi Print Agent started for ${config.agentId}`)
  while (!stopping) {
    try {
      const processed = await processNextJob()
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 250))
    } catch (error) {
      log('Backend connection failed; retrying', error)
      await new Promise((resolve) => setTimeout(resolve, 2000))
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
