module.exports = {
  packagerConfig: {
    name: 'VickersMeasurementSoftware',
    executableName: 'VickersMeasurementSoftware',
    appBundleId: 'com.chennaimetco.vickersmeasurementsoftware',
    // electron-packager appends the platform-correct extension (.ico on win32,
    // .icns on darwin, .png on linux). Drop the artwork into build/icon.{ico,icns,png}.
    icon: 'build/icon',
    asar: true,
    extraResource: [
      '.env.prod',
      'backend/.env.prod',
      'frontend/.env.prod',
      'backend/native',
      'native/serial-addon',
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
        win: {
          icon: 'build/icon.ico',
        },
        nsis: {
          installerIcon: 'build/icon.ico',
          uninstallerIcon: 'build/icon.ico',
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
