// A frontend turn that promises action ("我来查一下") but ends without any tool
// call announced work it never submitted. The gateway detects that mismatch and
// asks the model to either submit the work or stay silent.
//
// Detection deliberately inspects only the assistant's own wording, never the
// user's intent. Classifying whether a request needed execution would misfire on
// ordinary conversation, whereas "I said I would, but I did not" is a
// self-contradiction that stands on its own evidence.

const ACTION_PROMISE = new RegExp([
  '^',
  '(?:(?:好的?|好|行|明白|收到)[，,\\s]*)?',
  '(?:稍等[，,\\s]*)?',
  '(?:',
  '我(?:来|去|先去|马上|立刻|现在(?:就)?|这就)(?:帮你|替你)?',
  '|让我来',
  '|马上(?:去|来)?',
  '|现在就(?:去|来)?',
  ')',
  '(?:',
  '查(?:一下)?|查询|查找|看(?:一下)?|检查|确认|核实|搜索|排查|调查',
  '|处理|修改|调整|创建|新建|运行|跑(?:一下)?|测试|验证',
  ')',
  '[^，,。；;：:！？!?\\n]{0,28}',
  '[。！!]?',
  '$',
].join(''))

// A question asks for permission instead of claiming action. Correcting it would
// push the model to execute something the user has not agreed to yet.
const CONFIRMATION_REQUEST = new RegExp([
  '[？?]\\s*$',
  '好吗',
  '可以吗',
  '行吗',
  '要不要',
  '需要我',
  '是否需要',
  '要我(?:现在|先)?(?:去|来|帮)',
].join('|'))

// The fallback intentionally recognizes only one short, self-contained promise.
// It is not a general intent classifier: compound sentences and delivered answers
// must remain the model's responsibility.
export const ACTION_PROMISE_MAX_CHARS = 40

const DELIVERED_CONTENT = /(?:[：:]|结果|答案|查到|找到|发现|显示|已经(?:完成|处理|修改|创建|运行|测试)|原因是|因为)/

export const ACTION_PROMISE_CORRECTION = [
  '你刚才明确承诺执行，但本轮没有调用工具。',
  '请重新判断：确需执行则立即调用合适工具；否则直接结束，不要再次承诺。',
].join(' ')

export function promisesAction(transcript) {
  const content = String(transcript || '').trim()
  if (!content || content.length > ACTION_PROMISE_MAX_CHARS) return false
  if (CONFIRMATION_REQUEST.test(content)) return false
  if (DELIVERED_CONTENT.test(content)) return false
  return ACTION_PROMISE.test(content)
}

export function shouldCorrectActionPromise({
  origin = 'model',
  hasFunctionCall = false,
  failed = false,
  suppressed = false,
  transcript = '',
} = {}) {
  // Announcements and permission prompts are delivery, not routing decisions.
  if (origin !== 'model') return false
  // A tool call means the promise was kept.
  if (hasFunctionCall) return false
  // An interrupted, cancelled or failed turn proves nothing about routing.
  if (failed || suppressed) return false
  return promisesAction(transcript)
}

export function isCurrentActionPromiseTurn({
  sameFrontend = false,
  outputEnabled = false,
  userSpeaking = false,
  responseTurnId = '',
  responseTurnGeneration,
  committedTurnId = '',
  committedTurnGeneration,
} = {}) {
  return Boolean(
    sameFrontend
    && outputEnabled
    && !userSpeaking
    && responseTurnId
    && responseTurnId === committedTurnId
    && responseTurnGeneration === committedTurnGeneration,
  )
}
