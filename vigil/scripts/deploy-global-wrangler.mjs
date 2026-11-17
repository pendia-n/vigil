import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commandName = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
const globalPath = process.env.PATH.split(delimiter).find(directory => {
  const absolute = resolve(directory)
  return !absolute.startsWith(join(root, 'node_modules')) && existsSync(join(directory, commandName))
})

if (!globalPath) {
  throw new Error('Global Wrangler was not found on PATH. Install or expose the global wrangler command, then run deploy again.')
}

const executable = join(globalPath, commandName)
console.log('Deploying with global Wrangler: ' + executable)
execFileSync(executable, ['deploy'], { cwd: root, stdio: 'inherit' })
