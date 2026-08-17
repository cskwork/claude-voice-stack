import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayInputText,
  frontendInputProjection,
  normalizeInputParts,
  parseDataUrl,
} from '../shared/input-parts.mjs'

test('normalizes OpenCode-style text and image parts', () => {
  const parts = normalizeInputParts([
    { type: 'text', text: '分析 [Image 1]' },
    {
      type: 'file',
      mime: 'image/png',
      filename: 'screen.png',
      url: 'data:image/png;base64,aGVsbG8=',
      source: { type: 'clipboard', text: { value: '[Image 1]', start: 3, end: 12 } },
    },
  ])
  assert.equal(parts.length, 2)
  assert.equal(parseDataUrl(parts[1].url).bytes, 5)
  assert.equal(displayInputText(parts), '分析 [Image 1]')
  assert.match(frontendInputProjection(parts), /<user_attachments>/)
  assert.match(frontendInputProjection(parts), /screen\.png/)
})

test('rejects mismatched data URL MIME types', () => {
  assert.throws(() => normalizeInputParts([{
    type: 'file',
    mime: 'image/jpeg',
    url: 'data:image/png;base64,aGVsbG8=',
  }]), /MIME 不一致/)
})

test('rejects local file URLs submitted through the Gateway protocol', () => {
  assert.throws(() => normalizeInputParts([{
    type: 'file',
    mime: 'text/plain',
    url: 'file:///etc/hosts',
  }]), /不支持的附件 URL 协议/)
})

test('uses file labels for file-only turns', () => {
  const parts = normalizeInputParts([{
    type: 'file',
    mime: 'text/markdown',
    filename: 'SKILL.md',
    url: 'data:text/markdown;base64,IyBTa2lsbA==',
  }])
  assert.equal(displayInputText(parts), '@SKILL.md')
})
