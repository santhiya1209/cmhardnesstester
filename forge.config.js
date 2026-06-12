const path = require("node:path")

module.exports = {
  packagerConfig: {
    name: 'VickersMeasurementSoftware',
    executableName: 'VickersMeasurementSoftware',
    appBundleId: 'com.chennaimetco.vickersmeasurementsoftware',
    icon: path.resolve(__dirname, "frontend/public/vms icon"),
    asar: true,
    extraResource: [
      'drivers/opencv',
      'drivers/DVP2 x64',
      'drivers/redist',
      'drivers/USB Camera',
    ],
    ignore: [
      /^\/release($|\/)/,
      /^\/out($|\/)/,
      /^\/\.git($|\/)/,
      // drivers/ is shipped LOOSE via extraResource (read from process.resourcesPath
      // in cameraService.js + NSIS). Excluding it here drops the ~175 MB duplicate
      // copy that was otherwise packed into app.asar and never read.
      /^\/drivers($|\/)/,
      /^\/frontend\/src($|\/)/,
      /^\/frontend\/node_modules($|\/)/,
      /^\/frontend\/index\.html$/,
      /^\/frontend\/vite\.config\.ts$/,
      /^\/frontend\/tsconfig\.json$/,
      /^\/frontend\/package(-lock)?\.json$/,
      /^\/backend\/src($|\/)/,
      /^\/backend\/tsconfig\.json$/,
      // backend/ is a separate npm project, so Forge's root prune doesn't strip its
      // devDependencies. The backend ships only compiled backend/dist at runtime, so
      // these dev-only packages (~40 MB) must be excluded from the asar by hand.
      /^\/backend\/node_modules\/typescript($|\/)/,
      /^\/backend\/node_modules\/@esbuild($|\/)/,
      /^\/backend\/node_modules\/esbuild($|\/)/,
      /^\/backend\/node_modules\/tsx($|\/)/,
      /^\/backend\/node_modules\/@types($|\/)/,
      /^\/backend\/node_modules\/@electron($|\/)/,
      /^\/native\/hardness-addon\/src($|\/)/,
      /^\/native\/hardness-addon\/include($|\/)/,
      /^\/native\/hardness-addon\/bin($|\/)/,
      /^\/native\/hardness-addon\/node_modules($|\/)/,
      /^\/native\/hardness-addon\/build\/(?!Release(\/|$))/,
      /^\/native\/hardness-addon\/build\/Release\/.+\.(iobj|ipdb|pdb|exp|lib|obj)$/,
      /^\/native\/hardness-addon\/build\/Release\/obj($|\/)/,
      /^\/native\/hardness-addon\/build\/Release\/nothing\.lib$/,
      /^\/native\/hardness-addon\/binding\.gyp$/,
      /^\/native\/hardness-addon\/package(-lock)?\.json$/,
      /^\/native\/hardness-addon\/README\.md$/,
      /^\/native\/serial-addon\/src($|\/)/,
      /^\/native\/serial-addon\/node_modules($|\/)/,
      /^\/native\/serial-addon\/build\/(?!Release(\/|$))/,
      /^\/native\/serial-addon\/build\/Release\/.+\.(iobj|ipdb|pdb|exp|lib|obj)$/,
      /^\/native\/serial-addon\/build\/Release\/obj($|\/)/,
      /^\/native\/serial-addon\/binding\.gyp$/,
      /^\/native\/serial-addon\/package(-lock)?\.json$/,
      /^\/.claude($|\/)/,
      /^\/.electron-dist($|\/)/,
      /^\/.vscode($|\/)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: './makers/nsis-maker.js',
      platforms: ['win32'],
      config: {
        appId: 'com.chennaimetco.vickersmeasurementsoftware',
        productName: 'Vickers Measurement Software',
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        shortcutName: 'Vickers Measurement Software',
        // App icon used for desktop + Start menu shortcuts.
        win: { icon: path.resolve(__dirname, "frontend/public/icon.ico") },
        // Installer/uninstaller + setup header icons.
        nsis: {
          installerIcon: 'build/icon.ico',
          uninstallerIcon: 'build/icon.ico',
          installerHeaderIcon: 'build/icon.ico',
        },
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
  ],
};
