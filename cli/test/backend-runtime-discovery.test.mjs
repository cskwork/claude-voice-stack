import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'qwen-backend-runtime-'))
  const bin = resolve(directory, 'bin')
  const capture = resolve(directory, 'capture.txt')
  mkdirSync(bin)
  return {
    directory,
    bin,
    capture,
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

function command(path, {
  version = '',
  captureModels = false,
  captureNativePaths = false,
} = {}) {
  writeFileSync(path, [
    '#!/bin/sh',
    ...(version ? [
      'if [ "${1:-}" = "--version" ]; then',
      `  printf "%s\\n" "${version}"`,
      '  exit 0',
      'fi',
    ] : []),
    'printf "%s\\n" "$(basename "$0")" "$@" > "$CAPTURE"',
    ...(captureModels ? [
      'printf "%s\\n" "OPENCODE_MODEL=${OPENCODE_MODEL:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_MODEL=${QWEN_AUDIO_AGENT_OPENCLAW_MODEL:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_MODEL_ID=${QWEN_AUDIO_AGENT_OPENCLAW_MODEL_ID:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_CONFIG_PATH=${OPENCLAW_CONFIG_PATH:-}" >> "$CAPTURE"',
      'printf "%s\\n" "OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR:-}" >> "$CAPTURE"',
    ] : []),
    ...(captureNativePaths ? [
      'printf "%s\\n" "CODEX_PATH=${CODEX_PATH:-}" >> "$CAPTURE"',
      'printf "%s\\n" "CLAUDE_CODE_EXECUTABLE=${CLAUDE_CODE_EXECUTABLE:-}" >> "$CAPTURE"',
    ] : []),
    '',
  ].join('\n'))
  chmodSync(path, 0o755)
}

function execute(script, target, env = {}, args = []) {
  return spawnSync(resolve(root, script), args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${target.bin}:/usr/bin:/bin`,
      CAPTURE: target.capture,
      QWEN_AUDIO_AGENT_ENV_LOADED: '1',
      QWEN_AUDIO_AGENT_NODE: process.execPath,
      QWAUDIO_CONFIG_DIR: resolve(target.directory, 'config'),
      OPENCLAW_BUNDLE_BIN: '',
      ...env,
    },
  })
}

function run(script, target, env = {}, args = []) {
  const result = execute(script, target, env, args)
  assert.equal(result.status, 0, result.stderr)
  return readFileSync(target.capture, 'utf8').trim().split('\n')
}

test('OpenCode auto mode prefers the user-installed command', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'opencode'), { version: '1.20.0' })
    command(resolve(target.bin, 'npx'))
    assert.deepEqual(run('scripts/opencode-server', target, {
      OPENCODE_RUNTIME: 'auto',
      OPENCODE_PORT: '4321',
    }), [
      'opencode',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4321',
    ])
  } finally {
    target.close()
  }
})

test('OpenCode auto mode does not download a missing backend', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'npx'))
    const result = execute('scripts/opencode-server', target, {
      OPENCODE_RUNTIME: 'auto',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /OpenCode is not installed/)
    assert.equal(existsSync(target.capture), false)
  } finally {
    target.close()
  }
})

test('OpenCode auto mode rejects an incompatible installed version', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'opencode'), { version: '1.1.53' })
    command(resolve(target.bin, 'npx'))
    const result = execute('scripts/opencode-server', target, {
      OPENCODE_RUNTIME: 'auto',
      OPENCODE_PORT: '4321',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /older than the supported minimum/)
    assert.equal(existsSync(target.capture), false)
  } finally {
    target.close()
  }
})

test('OpenClaw auto mode prefers the user-installed command', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'openclaw'), {
      version: 'OpenClaw 2026.6.33',
      captureModels: true,
    })
    command(resolve(target.bin, 'npx'))
    assert.deepEqual(run('scripts/openclaw', target, {
      OPENCLAW_RUNTIME: 'auto',
      OPENCLAW_CONFIG_PATH: '/user/openclaw.json',
    }, ['gateway', 'run']).slice(0, 3), [
      'openclaw',
      'gateway',
      'run',
    ])
    assert.equal(
      readFileSync(target.capture, 'utf8').trim().split('\n').at(-2),
      'OPENCLAW_CONFIG_PATH=/user/openclaw.json',
    )
    assert.equal(
      readFileSync(target.capture, 'utf8').trim().split('\n').at(-1),
      'OPENCLAW_STATE_DIR=',
    )
    assert.equal(
      existsSync(resolve(
        target.directory,
        'config/backends/openclaw/openclaw.json5',
      )),
      false,
    )
    assert.match(
      readFileSync(
        resolve(target.directory, 'config/workspaces/openclaw/AGENTS.md'),
        'utf8',
      ),
      /qwen-audio-agent/,
    )
  } finally {
    target.close()
  }
})

test('OpenClaw auto mode prefers an explicit enterprise bundle', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    const bundle = resolve(target.directory, 'bundle-openclaw')
    command(bundle)
    command(resolve(target.bin, 'openclaw'), {
      version: 'OpenClaw 2026.6.33',
    })
    assert.deepEqual(run('scripts/openclaw', target, {
      OPENCLAW_RUNTIME: 'auto',
      OPENCLAW_BUNDLE_BIN: bundle,
    }, ['acp']), [
      'bundle-openclaw',
      'acp',
    ])
  } finally {
    target.close()
  }
})

test('OpenClaw auto mode preserves the user-installed version', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'openclaw'), {
      version: 'OpenClaw 2026.7.1-2',
    })
    const packageBinary = resolve(target.bin, 'openclaw-package')
    command(packageBinary)
    writeFileSync(resolve(target.bin, 'npx'), [
      '#!/bin/sh',
      'printf "%s\\n" "$FAKE_OPENCLAW_PACKAGE_BIN"',
      '',
    ].join('\n'))
    chmodSync(resolve(target.bin, 'npx'), 0o755)
    assert.deepEqual(run('scripts/openclaw', target, {
      OPENCLAW_RUNTIME: 'auto',
      FAKE_OPENCLAW_PACKAGE_BIN: packageBinary,
    }, ['acp']), [
      'openclaw',
      'acp',
    ])
  } finally {
    target.close()
  }
})

test('OpenClaw auto mode does not download a missing backend', {
  skip: process.platform === 'win32',
}, () => {
  const target = fixture()
  try {
    command(resolve(target.bin, 'npx'))
    const result = execute('scripts/openclaw', target, {
      OPENCLAW_RUNTIME: 'auto',
    }, ['acp'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /OpenClaw is not installed/)
    assert.equal(existsSync(target.capture), false)
  } finally {
    target.close()
  }
})

test('package mode uses pinned, configurable npm package versions', {
  skip: process.platform === 'win32',
}, () => {
  const openCode = fixture()
  const openClaw = fixture()
  try {
    command(resolve(openCode.bin, 'npx'))
    const packageBinary = resolve(openClaw.bin, 'openclaw-package')
    command(packageBinary)
    const resolverCapture = `${openClaw.capture}.resolve`
    writeFileSync(resolve(openClaw.bin, 'npx'), [
      '#!/bin/sh',
      'printf "%s\\n" "$(basename "$0")" "$@" > "$RESOLVE_CAPTURE"',
      'printf "%s\\n" "$FAKE_OPENCLAW_PACKAGE_BIN"',
      '',
    ].join('\n'))
    chmodSync(resolve(openClaw.bin, 'npx'), 0o755)
    assert.deepEqual(run('scripts/opencode-server', openCode, {
      OPENCODE_RUNTIME: 'package',
      OPENCODE_PORT: '4321',
    }), [
      'npx',
      '--yes',
      'opencode-ai@1.18.5',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4321',
    ])
    assert.deepEqual(run('scripts/openclaw', openClaw, {
      OPENCLAW_RUNTIME: 'package',
      RESOLVE_CAPTURE: resolverCapture,
      FAKE_OPENCLAW_PACKAGE_BIN: packageBinary,
    }, ['gateway', 'run']), [
      'openclaw-package',
      'gateway',
      'run',
    ])
    assert.deepEqual(
      readFileSync(resolverCapture, 'utf8').trim().split('\n'),
      [
        'npx',
        '--yes',
        '--package',
        'openclaw@2026.6.33',
        '--',
        'which',
        'openclaw',
      ],
    )
  } finally {
    openCode.close()
    openClaw.close()
  }
})

test('Codex ACP prefers an installed adapter and pins its package fallback', {
  skip: process.platform === 'win32',
}, () => {
  const binary = fixture()
  const packageRuntime = fixture()
  try {
    command(resolve(binary.bin, 'codex'))
    command(resolve(binary.bin, 'codex-acp'), {
      captureNativePaths: true,
    })
    command(resolve(packageRuntime.bin, 'codex'))
    command(resolve(packageRuntime.bin, 'npx'))
    const installed = run('scripts/codex-acp', binary, {
      CODEX_ACP_RUNTIME: 'auto',
    }, ['--help'])
    assert.deepEqual(installed.slice(0, 2), [
      'codex-acp',
      '--help',
    ])
    assert.equal(
      installed.at(-2),
      `CODEX_PATH=${resolve(binary.bin, 'codex')}`,
    )
    assert.deepEqual(run('scripts/codex-acp', packageRuntime, {
      CODEX_ACP_RUNTIME: 'package',
    }, ['--help']), [
      'npx',
      '-y',
      '@agentclientprotocol/codex-acp@1.1.7',
      '--help',
    ])
  } finally {
    binary.close()
    packageRuntime.close()
  }
})

test('Claude Code ACP prefers an installed adapter and pins its package fallback', {
  skip: process.platform === 'win32',
}, () => {
  const binary = fixture()
  const packageRuntime = fixture()
  try {
    command(resolve(binary.bin, 'claude'))
    command(resolve(binary.bin, 'claude-code-acp'), {
      captureNativePaths: true,
    })
    command(resolve(packageRuntime.bin, 'claude'))
    command(resolve(packageRuntime.bin, 'npx'))
    const installed = run('scripts/claude-code-acp', binary, {
      CLAUDE_CODE_ACP_RUNTIME: 'auto',
    }, ['--help'])
    assert.deepEqual(installed.slice(0, 2), [
      'claude-code-acp',
      '--help',
    ])
    assert.equal(
      installed.at(-1),
      `CLAUDE_CODE_EXECUTABLE=${resolve(binary.bin, 'claude')}`,
    )
    assert.deepEqual(run('scripts/claude-code-acp', packageRuntime, {
      CLAUDE_CODE_ACP_RUNTIME: 'package',
    }, ['--help']), [
      'npx',
      '-y',
      '@zed-industries/claude-code-acp@0.16.2',
      '--help',
    ])
  } finally {
    binary.close()
    packageRuntime.close()
  }
})

test('external ACP adapters require the user backend to be installed', {
  skip: process.platform === 'win32',
}, () => {
  const codex = fixture()
  const claude = fixture()
  try {
    command(resolve(codex.bin, 'codex-acp'))
    command(resolve(claude.bin, 'claude-code-acp'))
    const codexResult = execute('scripts/codex-acp', codex, {
      CODEX_ACP_RUNTIME: 'auto',
    })
    assert.notEqual(codexResult.status, 0)
    assert.match(codexResult.stderr, /Codex is not installed/)
    const claudeResult = execute('scripts/claude-code-acp', claude, {
      CLAUDE_CODE_ACP_RUNTIME: 'auto',
    })
    assert.notEqual(claudeResult.status, 0)
    assert.match(claudeResult.stderr, /Claude Code is not installed/)
  } finally {
    codex.close()
    claude.close()
  }
})

test('only maps a backend model when the user explicitly configures one', {
  skip: process.platform === 'win32',
}, () => {
  const openCode = fixture()
  const openClaw = fixture()
  try {
    command(resolve(openCode.bin, 'opencode'), {
      version: '1.20.0',
      captureModels: true,
    })
    command(resolve(openClaw.bin, 'openclaw'), {
      version: 'OpenClaw 2026.6.33',
      captureModels: true,
    })
    assert.deepEqual(run('scripts/opencode-server', openCode, {
      QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen-custom',
    }).slice(-5), [
      'OPENCODE_MODEL=alibaba-cn/qwen-custom',
      'OPENCLAW_MODEL=',
      'OPENCLAW_MODEL_ID=',
      'OPENCLAW_CONFIG_PATH=',
      'OPENCLAW_STATE_DIR=',
    ])
    assert.deepEqual(run('scripts/openclaw', openClaw, {
      QWEN_AUDIO_AGENT_BACKEND_MODEL: 'qwen-custom',
    }, ['gateway', 'run']).slice(-5), [
      'OPENCODE_MODEL=',
      'OPENCLAW_MODEL=',
      'OPENCLAW_MODEL_ID=',
      'OPENCLAW_CONFIG_PATH=',
      'OPENCLAW_STATE_DIR=',
    ])
  } finally {
    openCode.close()
    openClaw.close()
  }
})
