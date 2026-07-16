import path from 'node:path'

export interface AppIconPathOptions {
  appRoot: string
  isWindows: boolean
  resourcesPath: string | undefined
  unpackedAppRoot: string
}

export function appIconPaths({ appRoot, isWindows, resourcesPath, unpackedAppRoot }: AppIconPathOptions): string[] {
  if (isWindows) {
    return [
      resourcesPath ? path.join(resourcesPath, 'icon.ico') : null,
      path.join(appRoot, 'assets', 'icon.ico'),
      path.join(unpackedAppRoot, 'assets', 'icon.ico')
    ].filter((candidate): candidate is string => candidate !== null)
  }

  return [
    path.join(appRoot, 'public', 'apple-touch-icon.png'),
    path.join(appRoot, 'dist', 'apple-touch-icon.png'),
    path.join(unpackedAppRoot, 'dist', 'apple-touch-icon.png')
  ]
}

export function windowsAppUserModelId(isPackaged: boolean): string {
  return isPackaged ? 'com.nousresearch.hermes' : 'com.nousresearch.hermes.dev'
}
