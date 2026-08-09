#!/usr/bin/env node

import {
  prepareIsolatedOpenClawState,
  syncOpenClawGatewayTokenFile,
} from './backend-drivers/openclaw-auth.mjs'

const [, , command, ...args] = process.argv

if (command === 'prepare') {
  const [sourcePath, targetPath] = args
  const { config, auth } = prepareIsolatedOpenClawState({ sourcePath, targetPath })
  if (!config) {
    process.stderr.write('Unable to prepare isolated OpenClaw configuration.\n')
    process.exitCode = 1
  } else if (auth.seeded.length) {
    process.stderr.write(
      `OpenClaw isolated state: seeded portable auth profiles for agent(s) ${auth.seeded.join(', ')}.\n`,
    )
  }
} else if (command === 'sync-token') {
  syncOpenClawGatewayTokenFile({ targetPath: args[0] })
} else {
  process.stderr.write(`Unknown OpenClaw desktop helper command: ${command || '(empty)'}\n`)
  process.exitCode = 1
}
