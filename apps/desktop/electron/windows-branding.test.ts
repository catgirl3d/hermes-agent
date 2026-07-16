import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { rceditOptionsForHermes } from '../scripts/exe-identity-options.mjs'

import { appIconPaths, windowsAppUserModelId } from './windows-branding'

test('Windows icon paths prefer the packaged icon before development assets', () => {
  assert.deepEqual(
    appIconPaths({
      appRoot: '/app',
      isWindows: true,
      resourcesPath: '/resources',
      unpackedAppRoot: '/unpacked/app'
    }),
    [
      path.join('/resources', 'icon.ico'),
      path.join('/app', 'assets', 'icon.ico'),
      path.join('/unpacked/app', 'assets', 'icon.ico')
    ]
  )

  assert.deepEqual(
    appIconPaths({
      appRoot: '/app',
      isWindows: false,
      resourcesPath: '/resources',
      unpackedAppRoot: '/unpacked/app'
    }),
    [
      path.join('/app', 'public', 'apple-touch-icon.png'),
      path.join('/app', 'dist', 'apple-touch-icon.png'),
      path.join('/unpacked/app', 'dist', 'apple-touch-icon.png')
    ]
  )
})

test('development and packaged builds use separate Windows AppUserModelIDs', () => {
  assert.equal(windowsAppUserModelId(false), 'com.nousresearch.hermes.dev')
  assert.equal(windowsAppUserModelId(true), 'com.nousresearch.hermes')
})

test('PE stamping uses the Hermes executable identity', () => {
  assert.deepEqual(rceditOptionsForHermes('/desktop'), {
    icon: path.join('/desktop', 'assets', 'icon.ico'),
    'version-string': {
      CompanyName: 'Nous Research',
      FileDescription: 'Hermes',
      InternalName: 'Hermes',
      LegalCopyright: 'Copyright (c) 2026 Nous Research',
      OriginalFilename: 'Hermes.exe',
      ProductName: 'Hermes'
    }
  })
})
