const path = require('node:path')
const fs = require('node:fs/promises')
const { NtExecutable, NtExecutableResource, Resource } = require('resedit')

/**
 * Runs in electron-builder's afterSign hook (after winPackager.signAndEditResources)
 * so FileDescription and ProductName stay "墨笔生花" in Windows Task Manager while
 * preserving the embedded 7-size build/icon.ico, ELECTRONASAR integrity resource,
 * mobish.exe filename, and existing upgrade/auto-update paths.
 */
module.exports = async function afterSignWin(context) {
  if (context.electronPlatformName !== 'win32') return
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const buffer = await fs.readFile(exePath)
  const executable = NtExecutable.from(buffer)
  const res = NtExecutableResource.from(executable)
  const viList = Resource.VersionInfo.fromEntries(res.entries)
  const vi = viList.length > 0 ? viList[0] : Resource.VersionInfo.createEmpty()
  const languages = vi.getAllLanguagesForStringValues()
  const targets = languages.length > 0 ? languages : [{ lang: 0x0409, codepage: 1200 }]
  for (const lang of targets) {
    vi.setStringValues(lang, {
      FileDescription: '墨笔生花',
      ProductName: '墨笔生花',
    })
  }
  vi.outputToResourceEntries(res.entries)
  res.outputResource(executable)
  await fs.writeFile(exePath, Buffer.from(executable.generate()))
  console.log(`  • updated Windows PE metadata (FileDescription/ProductName = 墨笔生花)  file=${exePath}`)
}
