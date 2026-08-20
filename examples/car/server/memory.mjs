import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, 'data')

function memoryPath(clientId = 'default') {
  return resolve(dataDir, 'clients', clientId, 'memory.json')
}

async function ensureFile(clientId) {
  const p = memoryPath(clientId)
  try {
    await readFile(p)
  } catch {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, JSON.stringify({ items: [] }))
  }
}

async function load(clientId = 'default') {
  await ensureFile(clientId)
  const raw = await readFile(memoryPath(clientId), 'utf-8')
  return JSON.parse(raw)
}

async function save(clientId, data) {
  await writeFile(memoryPath(clientId), JSON.stringify(data, null, 2))
}

export async function readMemory(clientId = 'default', query) {
  const data = await load(clientId)
  if (query) {
    return data.items.filter((i) => i.content.includes(query))
  }
  return data.items
}

export async function writeMemory(clientId = 'default', content) {
  const data = await load(clientId)
  data.items.push({ content, time: new Date().toISOString() })
  await save(clientId, data)
}

export async function deleteMemory(clientId = 'default', index) {
  const data = await load(clientId)
  if (index >= 0 && index < data.items.length) {
    data.items.splice(index, 1)
    await save(clientId, data)
  }
}

export async function clearMemory(clientId = 'default') {
  await ensureFile(clientId)
  await save(clientId, { items: [] })
}

export async function getMemoryForPrompt(clientId = 'default') {
  const data = await load(clientId)
  if (data.items.length === 0) return ''
  const lines = ['【用户记忆】']
  data.items.forEach((i) => lines.push(`- ${i.content}`))
  return lines.join('\n')
}
