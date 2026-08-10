import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationSync } from '../src/conversation/conversation-sync.mjs'
import { FrontendMemoryService } from '../src/conversation/frontend-memory-service.mjs'
import { MarkdownContextStore } from '../src/conversation/markdown-context-store.mjs'
import {
  MemoryExtractor,
  createExtractorLlmCall,
} from '../src/conversation/memory-extractor.mjs'

const OWNER = 'owner'
const SESSION = 'main'

function chattySession(turns = 4, userText = '我每天早上都会跑步') {
  const sync = new ConversationSync()
  for (let index = 0; index < turns; index += 1) {
    sync.record({
      ownerId: OWNER,
      sessionId: SESSION,
      id: `user-${index}`,
      role: 'user',
      content: userText,
      source: 'voice-user',
    })
  }
  return sync
}

function extractor({
  llmCall,
  turns = 4,
  userText,
  audit = null,
  now = () => 1_000_000,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-extractor-'))
  const userStore = new MarkdownContextStore({
    filePath: join(directory, 'USER.md'),
    scope: 'user',
    template: '# USER',
  })
  const memoryStore = new MarkdownContextStore({
    filePath: join(directory, 'MEMORY.md'),
    scope: 'memory',
    template: '# MEMORY',
  })
  const memoryService = new FrontendMemoryService({ userStore, memoryStore })
  const instance = new MemoryExtractor({
    memoryService,
    conversationSync: chattySession(turns, userText),
    audit,
    llmCall,
    logger: { warn: () => {}, debug: () => {} },
    now,
  })
  return { instance, userStore, memoryStore, memoryService }
}

test('applies one natural Markdown patch to MEMORY.md', async () => {
  const events = []
  const { instance, memoryStore } = extractor({
    audit: { record: event => events.push(event) },
    llmCall: async () => JSON.stringify({
      changes: [{
        document: 'memory',
        edits: [],
        append: '## 习惯\n\n- 用户每天早上跑步。',
      }],
    }),
  })
  await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  const document = memoryStore.list(OWNER)[0]
  assert.match(document.content, /## 习惯[\s\S]*每天早上跑步/)
  assert.equal(events.at(-1).op, 'patch')
  assert.equal(events.at(-1).appended, true)
  assert.equal(events.at(-1).content, undefined)
})

test('can correct existing Markdown with an exact edit', async () => {
  const { instance, memoryStore } = extractor({
    llmCall: async () => JSON.stringify({
      changes: [{
        document: 'memory',
        edits: [{ old_text: '每天晚上跑步', new_text: '每天早上跑步' }],
        append: '',
      }],
    }),
  })
  memoryStore.edit(OWNER, { append: '- 用户每天晚上跑步' })
  await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  assert.match(memoryStore.read(OWNER), /每天早上跑步/)
  assert.doesNotMatch(memoryStore.read(OWNER), /每天晚上跑步/)
})

test('reconciles a misplaced directive across both documents atomically', async () => {
  const { instance, userStore, memoryStore } = extractor({
    userText: '以后每次回复都加一句爱你哟',
    llmCall: async () => JSON.stringify({
      changes: [
        {
          document: 'user',
          edits: [],
          append: '- 每次回复都加一句“爱你哟”',
        },
        {
          document: 'memory',
          edits: [{
            old_text: '- 用户要求助手每次回复都加一句“爱你哟”',
            new_text: '',
          }],
          append: '',
        },
      ],
    }),
  })
  memoryStore.edit(OWNER, {
    append: '- 用户要求助手每次回复都加一句“爱你哟”',
  })
  await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  assert.match(userStore.read(OWNER), /爱你哟/)
  assert.doesNotMatch(memoryStore.read(OWNER), /爱你哟/)
})

test('routes explicit interaction directives to USER.md', async () => {
  for (const [append, userText] of [
    ['- 用户希望回答简洁一点', '以后回答简洁一点'],
    ['- 用户希望助手以后叫小舟', '你以后叫小舟'],
    ['- 用户要求助手在每次回复开头加上“爱你哟”', '你每次回复开头加上爱你哟'],
    ['- 用户希望你在对话结尾说一句“你懂的”', '我希望你在对话结尾说一句你懂的'],
  ]) {
    const events = []
    const { instance, userStore, memoryStore } = extractor({
      userText,
      audit: { record: event => events.push(event) },
      llmCall: async () => JSON.stringify({
        changes: [{ document: 'user', edits: [], append }],
      }),
    })
    await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
    assert.match(userStore.read(OWNER), new RegExp(append.slice(2, 8)))
    assert.equal(memoryStore.read(OWNER), '')
    assert.equal(events.at(-1).op, 'patch')
  }
})

test('rejects document-boundary mistakes and sensitive data', async () => {
  for (const change of [
    { document: 'memory', append: '- 用户要求助手每次回复开头加上“爱你哟”' },
    { document: 'user', append: '- 用户每天早上跑步' },
    { document: 'memory', append: '- 用户的密码是 123456' },
  ]) {
    const events = []
    const { instance, userStore, memoryStore } = extractor({
      audit: { record: event => events.push(event) },
      llmCall: async () => JSON.stringify({ changes: [{ edits: [], ...change }] }),
    })
    await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
    assert.equal(userStore.read(OWNER), '')
    assert.equal(memoryStore.read(OWNER), '')
    assert.equal(events.at(-1).op, 'skip')
  }
})

test('does not infer a user directive without explicit transcript evidence', async () => {
  const events = []
  const { instance, userStore } = extractor({
    audit: { record: event => events.push(event) },
    userText: '今天聊得很开心',
    llmCall: async () => JSON.stringify({
      changes: [{
        document: 'user',
        edits: [],
        append: '- 每次回复都说“爱你哟”',
      }],
    }),
  })
  await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  assert.equal(userStore.read(OWNER), '')
  assert.equal(events.at(-1).reason, 'user_directive_not_explicit')
})

test('accepts fenced JSON and records no-change decisions', async () => {
  const events = []
  const { instance } = extractor({
    audit: { record: event => events.push(event) },
    llmCall: async () => '```json\n{"changes":[]}\n```',
  })
  await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  assert.equal(events.at(-1).reason, 'no_change')
})

test('stays disabled without a model, skips quiet sessions and debounces runs', async () => {
  const disabled = extractor({ llmCall: null })
  assert.equal(disabled.instance.maybeRun({ ownerId: OWNER, sessionId: SESSION }), null)
  let calls = 0
  const quiet = extractor({
    turns: 2,
    llmCall: async () => {
      calls += 1
      return '{"changes":[]}'
    },
  })
  assert.equal(quiet.instance.maybeRun({ ownerId: OWNER, sessionId: SESSION }), null)
  const active = extractor({
    llmCall: async () => {
      calls += 1
      return '{"changes":[]}'
    },
  })
  await active.instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
  assert.equal(active.instance.maybeRun({ ownerId: OWNER, sessionId: SESSION }), null)
  assert.equal(calls, 1)
})

test('survives provider and malformed-output failures without throwing', async () => {
  const events = []
  for (const llmCall of [
    async () => { throw new Error('provider unavailable') },
    async () => 'not json',
  ]) {
    const { instance } = extractor({ audit: { record: event => events.push(event) }, llmCall })
    await instance.maybeRun({ ownerId: OWNER, sessionId: SESSION })
    assert.equal(events.at(-1).op, 'error')
  }
})

test('createExtractorLlmCall posts to chat completions and surfaces errors', async () => {
  assert.equal(createExtractorLlmCall({ baseUrl: 'https://example.com/v1', apiKey: '' }), null)
  const requests = []
  const llmCall = createExtractorLlmCall({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'qwen-flash',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }
    },
  })
  assert.equal(await llmCall({ system: 's', user: 'u' }), '{}')
  assert.equal(requests[0].url, 'https://example.com/v1/chat/completions')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key')

  const failing = createExtractorLlmCall({
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'qwen-flash',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  })
  await assert.rejects(() => failing({ system: 's', user: 'u' }), /request failed: 429/)
})
