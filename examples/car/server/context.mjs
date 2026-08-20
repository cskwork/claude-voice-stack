import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sessionsDir = resolve(__dirname, 'data/sessions')

function sessionPath(sessionId) {
  return resolve(sessionsDir, sessionId, 'history.json')
}

async function ensureSession(sessionId) {
  const dir = resolve(sessionsDir, sessionId)
  await mkdir(dir, { recursive: true })
  const p = sessionPath(sessionId)
  try {
    await readFile(p)
  } catch {
    await writeFile(p, '[]')
  }
}

export async function loadHistory(sessionId) {
  await ensureSession(sessionId)
  const raw = await readFile(sessionPath(sessionId), 'utf-8')
  return JSON.parse(raw)
}

export async function saveHistory(sessionId, messages) {
  await ensureSession(sessionId)
  await writeFile(sessionPath(sessionId), JSON.stringify(messages, null, 2))
}

export async function clearHistory(sessionId) {
  await saveHistory(sessionId, [])
}

export async function appendToHistory(sessionId, ...msgs) {
  const history = await loadHistory(sessionId)
  history.push(...msgs)
  await saveHistory(sessionId, history)
}

export function buildMessages(history, maxRounds = 20) {
  if (history.length <= maxRounds * 3) return history
  return history.slice(-maxRounds * 3)
}

export async function compactHistory(sessionId, keepLast = 10, summarizer) {
  const history = await loadHistory(sessionId)
  if (history.length <= keepLast * 3) return history

  const toCompact = history.slice(0, -keepLast * 3)
  const toKeep = history.slice(-keepLast * 3)

  let summary = '对话摘要：'
  if (summarizer) {
    summary = await summarizer(toCompact)
  } else {
    const userMsgs = toCompact
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('; ')
    summary = `早期对话摘要：用户讨论了 ${userMsgs.slice(0, 200)}`
  }

  const compacted = [{ role: 'system', content: summary }, ...toKeep]
  await saveHistory(sessionId, compacted)
  return compacted
}
