const path = require("node:path")

module.exports = {
  packagerConfig: {
    name: 'VickersMeasurementSoftware',
    executableName: 'VickersMeasurementSoftware',
    appBundleId: 'com.chennaimetco.vickersmeasurementsoftware',
    // Windows EXE icon (electron-packager appends `.ico`). Same source the
    // BrowserWindow (electron/main.js resolveAppIcon) and NSIS installer use.
    icon: path.resolve(__dirname, "frontend/public/app-icon.png"),
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
      /^\/frontend\/src($|\/)/,
      /^\/frontend\/node_modules($|\/)/,
      /^\/frontend\/index\.html$/,
      /^\/frontend\/vite\.config\.ts$/,
      /^\/frontend\/tsconfig\.json$/,
      /^\/frontend\/package(-lock)?\.json$/,
      /^\/backend\/src($|\/)/,
      /^\/backend\/tsconfig\.json$/,
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
        win: { icon: 'build/icon.ico' },
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
