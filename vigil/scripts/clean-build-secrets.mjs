import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const generatedDevVars = resolve('dist/vigil/.dev.vars')
if (existsSync(generatedDevVars)) {
  rmSync(generatedDevVars, { force: true })
  console.log('Removed generated local Worker secrets from the build folder.')
}
