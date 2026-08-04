import { parentPort, workerData } from 'node:worker_threads'

import { inspectBackendSetupsAsync } from '../../shared/backend-setup.mjs'
import { refreshProcessPath } from './process-path.mjs'

function compactReport(report) {
  return {
    selected: report.selected,
    backends: report.backends.map(item => ({
      id: item.id,
      label: item.label,
      ready: item.ready,
      selected: item.selected,
      issues: item.issues,
    })),
  }
}

try {
  const env = { ...workerData.env }
  refreshProcessPath({
    env,
    platform: workerData.platform,
  })
  const report = await inspectBackendSetupsAsync({
    env,
    platform: workerData.platform,
  })
  parentPort.postMessage({
    ok: true,
    path: env.PATH || '',
    report: compactReport(report),
  })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error?.message || String(error),
  })
}
