/**
 * Proof for the custom-endpoint .env writer: round-trips real values through
 * the production code path (writeEnvKeys -> reloadEnv -> customChatConfig),
 * then restores the file. Run with:
 *   npx tsx scripts/verify-custom-endpoint.ts
 */
import { readFileSync } from 'node:fs'
import { clearEnvKeys, envFilePath, writeEnvKeys } from '../server/envFile.ts'
import { reloadEnv, env } from '../server/env.ts'
import { customChatConfig } from '../server/chatCompletionsAgent.ts'

const path = envFilePath()
const before = readFileSync(path, 'utf8')

function show(tag: string) {
  const config = customChatConfig()
  console.log(
    `  ${tag.padEnd(10)} url=${JSON.stringify(env.DOOP_CUSTOM_CHAT_URL ?? '')} model=${JSON.stringify(env.DOOP_CUSTOM_CHAT_MODEL ?? '')} hasKey=${Boolean(env.DOOP_CUSTOM_CHAT_KEY)} vision=${env.DOOP_CUSTOM_CHAT_VISION} => customChatConfig=${config ? `{${config.label} @ ${config.url} (${config.model})}` : 'null'}`,
  )
}

try {
  console.log('1. baseline (nothing configured)')
  show('start')

  console.log('2. write a full endpoint')
  writeEnvKeys({
    DOOP_CUSTOM_CHAT_URL: 'http://localhost:20128/v1/chat/completions',
    DOOP_CUSTOM_CHAT_MODEL: 'deepseek-v4.1-flash',
    DOOP_CUSTOM_CHAT_LABEL: '9Router',
    DOOP_CUSTOM_CHAT_KEY: 'sk-test-abc',
    DOOP_CUSTOM_CHAT_VISION: 'true',
  })
  reloadEnv()
  show('after put')

  console.log('3. rewrite the same keys (must not duplicate)')
  writeEnvKeys({
    DOOP_CUSTOM_CHAT_URL: 'http://localhost:9999/v1/chat/completions',
    DOOP_CUSTOM_CHAT_MODEL: 'other-model',
    DOOP_CUSTOM_CHAT_LABEL: 'Gateway 2',
    DOOP_CUSTOM_CHAT_VISION: 'false',
  })
  reloadEnv()
  show('after 2nd')

  const body = readFileSync(path, 'utf8')
  const urlLines = body.split(/\r?\n/).filter((l) => l.startsWith('DOOP_CUSTOM_CHAT_URL='))
  console.log(`  key lines for URL: ${urlLines.length} (must be 1)`)
  console.log(`  stored line: ${urlLines[0]}`)

  console.log('4. clear')
  clearEnvKeys([
    'DOOP_CUSTOM_CHAT_URL',
    'DOOP_CUSTOM_CHAT_KEY',
    'DOOP_CUSTOM_CHAT_MODEL',
    'DOOP_CUSTOM_CHAT_LABEL',
    'DOOP_CUSTOM_CHAT_VISION',
  ])
  reloadEnv()
  show('after del')

  console.log('PASS: writer round-trips, no duplicates, clears cleanly')
} finally {
  /* restore whatever the instance .env held before this script ran */
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, before, 'utf8')
  reloadEnv()
  console.log('restored .env')
}
