import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { repoRoot } from '../lib/paths.mjs'

const execFileAsync = promisify(execFile)
const promptPath = resolve(repoRoot, 'config/prompts/foreground-glm/PROMPT.md')

test('foreground prompt stays small and keeps the Gateway tool contract', () => {
  const prompt = readFileSync(promptPath, 'utf8')
  assert.ok(prompt.length <= 2400, `prompt is ${prompt.length} chars; keep it under ~500 tokens`)
  for (const name of ['spawn_thinking', 'cancel_agent_task', 'get_agent_task_status', 'respond_permission', 'respond_agent_input']) {
    assert.ok(prompt.includes(`\`${name}\``), `prompt must reference ${name}`)
  }
  for (const tag of ['<permission_request>', '<backend_input_request>']) {
    assert.ok(prompt.includes(tag), `prompt must explain ${tag}`)
  }
  assert.match(prompt, /Claude Code/)
  assert.match(prompt, /do not commit/i)
})

test('upstream Gateway loads the profile prompt through QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR', async () => {
  const script = [
    "const { buildFrontendInstructions } = await import('./server/src/frontend/frontend-tools.mjs')",
    'process.stdout.write(buildFrontendInstructions({}))',
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR: 'config/prompts/foreground-glm',
      QWEN_AUDIO_AGENT_ASSISTANT_PROFILE_PATH: 'config/prompts/foreground-glm/ASSISTANT.md',
      QWAUDIO_CONFIG_DIR: resolve(repoRoot, 'node_modules/.cache/voice-stack-test-config'),
    },
  })
  assert.ok(stdout.startsWith('# Role\n\nYou are the one voice assistant'))
  assert.ok(stdout.includes('your name is Voice'))
  assert.ok(!stdout.includes('千问Audio'))
})
