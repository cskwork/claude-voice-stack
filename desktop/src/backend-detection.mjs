import { Worker } from 'node:worker_threads'

const defaultWorkerUrl = new URL('./backend-detection-worker.mjs', import.meta.url)

export function detectBackendSetups({
  env = process.env,
  platform = process.platform,
  WorkerImpl = Worker,
  workerUrl = defaultWorkerUrl,
} = {}) {
  return new Promise((resolve, reject) => {
    const worker = new WorkerImpl(workerUrl, {
      workerData: {
        env: { ...env },
        platform,
      },
    })
    let settled = false

    const finish = callback => value => {
      if (settled) return
      settled = true
      callback(value)
    }
    const succeed = finish(message => {
      if (!message?.ok) {
        reject(new Error(message?.error || '后台 Agent 检测失败'))
        return
      }
      resolve({
        path: message.path || '',
        report: message.report,
      })
    })
    const fail = finish(reject)

    worker.once('message', succeed)
    worker.once('error', fail)
    worker.once('exit', code => {
      fail(new Error(
        code === 0
          ? '后台 Agent 检测进程未返回结果'
          : `后台 Agent 检测进程异常退出：${code}`,
      ))
    })
  })
}
