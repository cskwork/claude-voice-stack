import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MarkdownContextStore } from '../src/conversation/markdown-context-store.mjs'

function store(scope = 'memory') {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-markdown-memory-'))
  const filePath = join(directory, scope === 'user' ? 'USER.md' : 'MEMORY.md')
  return {
    filePath,
    store: new MarkdownContextStore({
      filePath,
      scope,
      template: scope === 'user' ? '# USER' : '# MEMORY',
    }),
  }
}

test('keeps memory content as ordinary human-readable Markdown', () => {
  const { store: memory, filePath } = store()
  const result = memory.edit('user_personal', {
    append: '## 兴趣\n\n- 用户喜欢打篮球。',
  })
  assert.equal(result.changed, 1)
  assert.equal(
    readFileSync(filePath, 'utf8'),
    '# MEMORY\n\n## 兴趣\n\n- 用户喜欢打篮球。\n',
  )
  assert.equal(memory.list('user_personal')[0].format, 'markdown')
})

test('applies multiple exact edits atomically for updates and deletion', () => {
  const { store: memory } = store()
  const first = memory.edit('user_personal', {
    append: '## 用户\n\n- 称呼为老板。\n- 喜欢篮球。',
  })
  const result = memory.edit('user_personal', {
    expectedRevision: first.document.revision,
    edits: [
      { old_text: '- 称呼为老板。', new_text: '- 称呼为船长。' },
      { old_text: '- 喜欢篮球。', new_text: '' },
    ],
  })
  assert.equal(result.changed, 2)
  assert.match(result.document.content, /称呼为船长/)
  assert.doesNotMatch(result.document.content, /喜欢篮球/)
})

test('rejects stale revisions and removes duplicate or empty bullet placeholders', () => {
  const { store: memory, filePath } = store()
  const first = memory.edit('user_personal', { append: '- \n- 相同\n- 相同' })
  assert.throws(() => memory.edit('user_personal', {
    expectedRevision: 'stale',
    append: '- 新内容',
  }), error => error.code === 'stale_document')
  const unchanged = memory.edit('user_personal', {
    expectedRevision: first.document.revision,
    append: '- 相同',
  })
  assert.equal(unchanged.changed, 0)
  assert.equal(readFileSync(filePath, 'utf8'), '# MEMORY\n\n- 相同\n')
})

test('isolates non-personal owners into separate Markdown files', () => {
  const { store: memory, filePath } = store()
  memory.edit('owner-a', { append: '- A 的记忆' })
  memory.edit('owner-b', { append: '- B 的记忆' })
  assert.equal(memory.read('user_personal'), '')
  assert.equal(memory.read('owner-a').includes('A 的记忆'), true)
  assert.equal(memory.read('owner-b').includes('B 的记忆'), true)
  assert.throws(() => readFileSync(filePath, 'utf8'), /ENOENT/)
})
