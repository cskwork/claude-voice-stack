import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  MAX_INPUT_FILE_BYTES,
  inputPartLabel,
  withAttachmentAnchors,
} from '../../shared/input-parts.mjs'

const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
  ['.json', 'application/json'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.jsx', 'text/javascript'],
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.csv', 'text/csv'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.zip', 'application/zip'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
])

function extension(path) {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export async function filePartFromPath(value, index = 0, reference = null) {
  const path = resolve(String(value || '').trim())
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`不是普通文件：${path}`)
  if (info.size > MAX_INPUT_FILE_BYTES) {
    throw new Error(`文件超过 ${MAX_INPUT_FILE_BYTES / 1024 / 1024} MB 限制：${path}`)
  }
  const content = await readFile(path)
  const filename = basename(path)
  const mime = MIME_BY_EXTENSION.get(extension(path)) || 'application/octet-stream'
  const label = reference?.value
    || (mime.startsWith('image/') ? `[Image ${index + 1}]` : `@${filename}`)
  return {
    type: 'file',
    mime,
    filename,
    url: `data:${mime};base64,${content.toString('base64')}`,
    source: {
      type: 'file',
      path,
      text: {
        value: label,
        ...(Number.isInteger(reference?.start) ? { start: reference.start } : {}),
        ...(Number.isInteger(reference?.end) ? { end: reference.end } : {}),
      },
    },
  }
}

function referencedPaths(text) {
  const values = []
  const pattern = /@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g
  for (const match of String(text || '').matchAll(pattern)) {
    values.push({
      path: match[1] || match[2] || match[3],
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return values
}

export async function inputPartsFromText(text, staged = []) {
  const parts = [...staged]
  const paths = referencedPaths(text)
  for (const reference of paths) {
    const resolved = resolve(reference.path)
    if (parts.some(part => part?.source?.path === resolved)) continue
    try {
      parts.push(await filePartFromPath(
        reference.path,
        parts.length,
        reference,
      ))
    } catch (error) {
      // A literal @mention is still ordinary text. Only an existing path is
      // promoted into a file part; explicit attachment selection still
      // surfaces invalid paths to the user through filePartFromPath().
      if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error
    }
  }
  return withAttachmentAnchors([
    ...(String(text || '').trim() ? [{ type: 'text', text: String(text).trim() }] : []),
    ...parts,
  ])
}

export function stagedInputSummary(parts = []) {
  return parts.map((part, index) => inputPartLabel(part, index)).join(' ')
}
