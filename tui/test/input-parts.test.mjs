import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  filePartFromPath,
  inputPartsFromText,
} from '../src/input-parts.mjs'

test('creates OpenCode-style inline file parts from TUI paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qaa-tui-input-'))
  const path = join(directory, 'SKILL.md')
  await writeFile(path, '# Skill')
  const part = await filePartFromPath(path)
  assert.equal(part.type, 'file')
  assert.equal(part.mime, 'text/markdown')
  assert.match(part.url, /^data:text\/markdown;base64,/)
})

test('expands @path references into file parts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qaa-tui-input-'))
  const path = join(directory, 'sample.txt')
  await writeFile(path, 'hello')
  const parts = await inputPartsFromText(`分析 @${path}`)
  assert.equal(parts[0].type, 'text')
  assert.equal(parts[1].filename, 'sample.txt')
})

test('keeps ordinary @mentions as text when they are not paths', async () => {
  const parts = await inputPartsFromText('请问 @designer 的意见')
  assert.deepEqual(parts, [{ type: 'text', text: '请问 @designer 的意见' }])
})
