module.exports = {
  packagerConfig: {
    name: 'HardnessTester',
    appBundleId: 'com.chennaimetco.hardnesstester',
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
        appId: 'com.chennaimetco.hardnesstester',
        productName: 'HardnessTester',
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        shortcutName: 'HardnessTester',
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
