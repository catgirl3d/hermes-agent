import { join } from 'node:path'

export function rceditOptionsForHermes(desktopRoot) {
  return {
    icon: join(desktopRoot, 'assets', 'icon.ico'),
    'version-string': {
      ProductName: 'Hermes',
      FileDescription: 'Hermes',
      OriginalFilename: 'Hermes.exe',
      InternalName: 'Hermes',
      CompanyName: 'Nous Research',
      LegalCopyright: 'Copyright (c) 2026 Nous Research'
    }
  }
}
