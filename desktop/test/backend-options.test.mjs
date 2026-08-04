import assert from 'node:assert/strict'
import test from 'node:test'
import { backendOptionStates } from '../src/backend-options.mjs'

function report(backends) {
  return { selected: '', readOnly: true, backends }
}

function backend(overrides) {
  return {
    id: 'x',
    label: 'X',
    ready: false,
    selected: false,
    issues: [],
    install: { supported: false },
    ...overrides,
  }
}

test('always offers the none option first, even without a report', () => {
  const states = backendOptionStates(null)
  assert.deepEqual(states, [{
    id: 'none',
    label: '不使用后台 Agent',
    ready: true,
    selectable: true,
    installable: false,
    requiresConfirmation: false,
    reason: '',
    title: '',
  }])
})

test('ready backends are selectable and never installable', () => {
  const states = backendOptionStates(report([
    backend({
      id: 'opencode',
      label: 'OpenCode',
      ready: true,
      install: { supported: true, requiresConfirmation: false, steps: [] },
    }),
  ]))
  assert.deepEqual(states[1], {
    id: 'opencode',
    label: 'OpenCode',
    ready: true,
    selectable: true,
    installable: false,
    requiresConfirmation: false,
    reason: '',
    title: '',
  })
})

test('unavailable installable backends show a short reason and full title', () => {
  const states = backendOptionStates(report([
    backend({
      id: 'claude',
      label: 'Claude Code',
      issues: ['未找到 Claude Code，请先安装并完成原生配置'],
      install: { supported: true, requiresConfirmation: false, steps: [] },
    }),
  ]))
  assert.equal(states[1].label, 'Claude Code')
  assert.equal(states[1].selectable, false)
  assert.equal(states[1].installable, true)
  assert.equal(states[1].reason, '未安装')
  assert.equal(states[1].title, '未找到 Claude Code，请先安装并完成原生配置')
})

test('script-based installs mark the row as requiring confirmation', () => {
  const states = backendOptionStates(report([
    backend({
      id: 'hermes',
      label: 'Hermes',
      issues: ['未找到 Hermes'],
      install: { supported: true, requiresConfirmation: true, steps: [] },
    }),
  ]))
  assert.equal(states[1].installable, true)
  assert.equal(states[1].requiresConfirmation, true)
})

test('backends without an install spec are not installable', () => {
  const states = backendOptionStates(report([
    backend({
      id: 'acp',
      label: 'ACP Agent',
      issues: ['ACP_COMMAND 指定的命令不可用：missing-agent'],
      install: {
        supported: false,
        reason: '通用 ACP 后台需自行安装，并通过 ACP_COMMAND 配置',
      },
    }),
  ]))
  assert.equal(states[1].installable, false)
  assert.equal(states[1].reason, '需要配置')
})

test('missing install information falls back to not installable', () => {
  const states = backendOptionStates(report([
    {
      id: 'qoder',
      label: 'Qoder',
      ready: false,
      selected: false,
      issues: ['未找到 Qoder CLI'],
    },
  ]))
  assert.equal(states[1].installable, false)
  assert.equal(states[1].reason, '未安装')
})

test('keeps the selected backend selectable even when unavailable', () => {
  const states = backendOptionStates(report([
    backend({
      id: 'claude',
      selected: true,
      issues: ['未找到 Claude Code，请先安装并完成原生配置'],
      install: { supported: true, requiresConfirmation: false, steps: [] },
    }),
  ]))
  assert.equal(states[1].selectable, true)
  assert.equal(states[1].installable, true)
})

test('classifies issue texts into short reasons', () => {
  const cases = [
    ['PATH 中未找到 OpenCode', '未安装'],
    ['未找到 Kimi Code，请先安装并完成原生配置', '未安装'],
    ['OpenCode 1.17.9 低于最低版本 1.18.0', '版本不兼容'],
    ['Kimi Code 版本不兼容；自动部署需要 DASHSCOPE_API_KEY', '版本不兼容'],
    ['无法确认 Kimi Code 版本', '版本不兼容'],
    ['缺少 DASHSCOPE_API_KEY 和 QWEN_AUDIO_AGENT_BACKEND_MODEL', '缺少百炼配置'],
    ['缺少 claude-code-acp，并且 npx 不可用', '需要 ACP 适配器'],
    ['ACP_COMMAND 指定的命令不可用：missing-agent', '需要配置'],
    ['', '当前不可用'],
  ]
  for (const [issue, reason] of cases) {
    const states = backendOptionStates(report([
      backend({ issues: [issue] }),
    ]))
    assert.equal(states[1].reason, reason, issue)
  }
})
