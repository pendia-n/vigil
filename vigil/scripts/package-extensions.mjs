import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'extension')
const downloads = join(root, 'public', 'downloads')
const baseManifest = JSON.parse(readFileSync(join(source, 'manifest.base.json'), 'utf8'))
const appFiles = ['background.js', 'popup.html', 'popup.css', 'popup.js', 'pause.html', 'pause.css', 'pause.js', 'focus-cue.mp3']

mkdirSync(downloads, { recursive: true })
for (const archive of ['vigil-chrome-brave.zip', 'vigil-firefox.zip']) {
  rmSync(join(downloads, archive), { force: true })
}

const variants = [
  {
    slug: 'vigil-chrome-brave',
    background: { service_worker: 'background.js' },
    manifest: { minimum_chrome_version: '120' },
    archive: 'vigil-chrome-brave.zip',
  },
  {
    slug: 'vigil-firefox',
    background: { scripts: ['background.js'] },
    manifest: {
      browser_specific_settings: {
        gecko: {
          id: 'vigil-focus@vigil.app',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    },
    archive: 'vigil-firefox.zip',
  },
]

for (const variant of variants) {
  const stage = mkdtempSync(join(tmpdir(), 'vigil-extension-'))
  for (const file of appFiles) cpSync(join(source, file), join(stage, file))
  cpSync(join(source, 'icons'), join(stage, 'icons'), { recursive: true })
  const manifest = {
    ...baseManifest,
    ...variant.manifest,
    background: variant.background,
  }
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const archivePath = join(downloads, variant.archive)
  execFileSync('zip', ['-q', '-r', archivePath, '.'], { cwd: stage })
  rmSync(stage, { recursive: true, force: true })
}

console.log('Packaged Chromium and Firefox extension downloads.')
