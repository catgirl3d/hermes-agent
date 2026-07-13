import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readMain() {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8').replace(/\r\n/g, '\n')
}

function readStampScript() {
  return fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-exe-identity.mjs'), 'utf8').replace(/\r\n/g, '\n')
}

test('Windows windows prefer the packaged icon.ico over web PNG assets', () => {
  const source = readMain()
  assert.match(source, /const APP_ICON_PATHS = IS_WINDOWS/, 'Windows icon candidates must be split from non-Windows ones')
  assert.match(
    source,
    /process\.resourcesPath \? path\.join\(process\.resourcesPath, 'icon\.ico'\) : null/,
    'packaged Windows builds must probe resources/icon.ico first'
  )
  assert.match(source, /path\.join\(APP_ROOT, 'assets', 'icon\.ico'\)/, 'dev Windows runs must probe assets/icon.ico')
})

test('set-exe-identity stamps Hermes PE identity, not just ProductName', () => {
  const source = readStampScript()
  assert.match(source, /OriginalFilename: 'Hermes\.exe'/, 'exe stamp must override Electron\'s OriginalFilename')
  assert.match(source, /InternalName: 'Hermes'/, 'exe stamp must override Electron\'s InternalName')
})

test('dev Electron does not claim the packaged Hermes AppUserModelID', () => {
  const source = readMain()
  assert.match(
    source,
    /const WINDOWS_APP_USER_MODEL_ID = IS_PACKAGED \? 'com\.nousresearch\.hermes' : 'com\.nousresearch\.hermes\.dev'/,
    'dev and packaged builds must have separate Windows AppUserModelIDs'
  )
  assert.match(source, /app\.setAppUserModelId\(WINDOWS_APP_USER_MODEL_ID\)/)
})
