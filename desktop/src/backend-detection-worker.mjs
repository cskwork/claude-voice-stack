import { parentPort, workerData } from 'node:worker_threads'

import { inspectBackendSetupsAsync } from '../../shared/backend-setup.mjs'
import { refreshProcessPath } from './process-path.mjs'

function compactComponent(component) {
  if (!component || typeof component !== 'object') return undefined
  // 组件级就绪状态供一键安装判断“只补缺失组件”（如仅缺 ACP 适配器）。
  return { ready: component.ready === true, source: component.source || '' }
}

function compactReport(report) {
  return {
    selected: report.selected,
    backends: report.backends.map(item => ({
      id: item.id,
      label: item.label,
      ready: item.ready,
      selected: item.selected,
      issues: item.issues,
      backend: compactComponent(item.backend),
      adapter: compactComponent(item.adapter),
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
