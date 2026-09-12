import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export const DEFAULT_PROFILE = 'config/profiles/glm-supertonic-claude.env.example'

// Everything the voice stack owns outside the repository lives under one
// directory so `doctor` and `stop` never guess at locations.
export function stackHome(env = process.env, home = homedir()) {
  return env.CLAUDE_VOICE_STACK_HOME
    ? resolve(env.CLAUDE_VOICE_STACK_HOME)
    : resolve(home, '.claude-voice-stack')
}

export function stackPaths(env = process.env, home = homedir()) {
  const root = stackHome(env, home)
  return {
    home: root,
    configPath: resolve(root, 'config.env'),
    venv: resolve(root, 'venv-s2s'),
    python: resolve(root, 'venv-s2s/bin/python'),
    speechToSpeechBin: resolve(root, 'venv-s2s/bin/speech-to-speech'),
    supertonicBin: resolve(root, 'venv-s2s/bin/supertonic'),
    logs: resolve(root, 'logs'),
    run: resolve(root, 'run'),
    pid: name => resolve(root, 'run', `${name}.pid`),
    log: name => resolve(root, 'logs', `${name}.log`),
  }
}
