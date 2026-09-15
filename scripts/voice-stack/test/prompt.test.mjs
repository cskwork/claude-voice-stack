import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  assert.match(prompt, /configured backend agent/)
  assert.match(prompt, /do not commit/i)
})

for (const newline of ['\n', '\r\n']) {
  test(`upstream Gateway loads the profile prompt with ${newline === '\n' ? 'LF' : 'CRLF'} line endings`, async t => {
    const dir = mkdtempSync(resolve(tmpdir(), 'voice-prompt-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    for (const name of ['PROMPT.md', 'ASSISTANT.md']) {
      const source = readFileSync(resolve(repoRoot, 'config/prompts/foreground-glm', name), 'utf8')
      writeFileSync(resolve(dir, name), source.replace(/\r?\n/g, newline))
    }
    const script = [
      "const { buildFrontendInstructions } = await import('./server/src/frontend/frontend-tools.mjs')",
      'process.stdout.write(buildFrontendInstructions({}))',
    ].join('\n')
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        QWEN_AUDIO_AGENT_FRONTEND_PROMPT_DIR: dir,
        QWEN_AUDIO_AGENT_ASSISTANT_PROFILE_PATH: resolve(dir, 'ASSISTANT.md'),
        QWAUDIO_CONFIG_DIR: resolve(dir, 'config'),
      },
    })
    assert.match(stdout, /^# Role\r?\n\r?\nYou are the one voice assistant/)
    assert.ok(stdout.includes('your name is Voice'))
    assert.ok(!stdout.includes('千问Audio'))
  })
}
