import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPromptCapabilities,
  inputPartsToAcpBlocks,
  promptWithInputParts,
  transformPromptText,
} from '../src/agent/acp-content.mjs'

const image = {
  type: 'file',
  mime: 'image/png',
  filename: 'reference.png',
  url: 'data:image/png;base64,aGVsbG8=',
}

test('maps OpenCode-style image parts to ACP image blocks', () => {
  assert.deepEqual(inputPartsToAcpBlocks([image]), [{
    type: 'image',
    mimeType: 'image/png',
    data: 'aGVsbG8=',
    uri: 'qwen-audio-agent://input/reference.png',
  }])
  assert.equal(promptWithInputParts('hello', []).constructor, String)
  assert.equal(promptWithInputParts('hello', [image])[0].text, 'hello')
})

test('maps inline text files to ACP embedded resources', () => {
  const [block] = inputPartsToAcpBlocks([{
    type: 'file',
    mime: 'text/markdown',
    filename: 'SKILL.md',
    url: 'data:text/markdown;base64,IyBTa2lsbA==',
  }])
  assert.equal(block.type, 'resource')
  assert.equal(block.resource.text, '# Skill')
})

test('checks optional ACP prompt capabilities', () => {
  assert.throws(
    () => assertPromptCapabilities(inputPartsToAcpBlocks([image]), {}),
    /图片输入能力/,
  )
  assert.doesNotThrow(() => assertPromptCapabilities(
    inputPartsToAcpBlocks([image]),
    { promptCapabilities: { image: true } },
  ))
})

test('preserves non-text blocks while wrapping prompt text', () => {
  const transformed = transformPromptText(
    [{ type: 'text', text: 'request' }, { type: 'image', data: 'x', mimeType: 'image/png' }],
    text => `wrapped:${text}`,
  )
  assert.equal(transformed[0].text, 'wrapped:request')
  assert.equal(transformed[1].type, 'image')
})
