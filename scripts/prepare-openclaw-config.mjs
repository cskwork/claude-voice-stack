#!/usr/bin/env node

import {
  prepareIsolatedOpenClawState,
} from '../server/src/process/backend-drivers/openclaw-auth.mjs'

const [, , sourcePath, targetPath] = process.argv
const { config, auth } = prepareIsolatedOpenClawState({ sourcePath, targetPath })
if (!config) {
  process.stderr.write('Unable to prepare isolated OpenClaw configuration.\n')
  process.exitCode = 1
} else if (auth.seeded.length) {
  process.stderr.write(
    `OpenClaw isolated state: seeded portable auth profiles for agent(s) ${auth.seeded.join(', ')}.\n`,
  )
}
