module.exports = {
  packagerConfig: {
    name: 'VickersMeasurementSoftware',
    executableName: 'VickersMeasurementSoftware',
    appBundleId: 'com.chennaimetco.vickersmeasurementsoftware',
    // App icon: drop `icon.ico` (win) / `icon.icns` (mac) / `icon.png` (linux)
    // into build/ and uncomment the line below. Without this the packager
    // falls back to Electron's default icon.
    // icon: 'build/icon',
    asar: true,
    extraResource: [
      // .env.prod files are NOT shipped — their parallel copy races with
      // VS Code / Codex file watchers and produces EBUSY during `npm run
      // make`. Frontend env vars are already baked into the Vite bundle at
      // build time. Root + backend env vars (micrometer port/baud, backend
      // PORT, SQLite DB location) fall back to defaults / undefined at
      // runtime in the packaged app — set via OS env vars or wire defaults
      // in code if needed.
      //
      // backend/native is NOT an extraResource — the .node files ride inside
      // app.asar and are auto-extracted to app.asar.unpacked/ by the
      // @electron-forge/plugin-auto-unpack-natives plugin below.
      // native/serial-addon is intentionally NOT bundled.
      //
      // Third-party runtime DLLs the addon depends on. extraResource flattens
      // the source folder into resources/<name>/ at install time:
      //   vendor/opencv      -> resources/opencv/
      //   vendor/camera-sdk  -> resources/camera-sdk/
      // cameraService.js adds these to PATH / passes resources/camera-sdk as
      // the DVP dllSearchDir at startup.
      'vendor/opencv',
      'vendor/camera-sdk',
      // vc_redist.x64.exe — chained by build/installer.nsh during install.
      // Fetched on demand by scripts/fetch-vc-redist.js (prepackage hook), not
      // committed to git.
      'vendor/redist',
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
      // hardness-addon native source + build intermediates — only the .node
      // binary itself should travel into the asar. auto-unpack-natives moves
      // it to app.asar.unpacked at package time.
      /^\/backend\/native\/hardness-addon\/src($|\/)/,
      /^\/backend\/native\/hardness-addon\/include($|\/)/,
      /^\/backend\/native\/hardness-addon\/bin($|\/)/,
      /^\/backend\/native\/hardness-addon\/node_modules($|\/)/,
      /^\/backend\/native\/hardness-addon\/build\/(?!Release(\/|$))/,
      /^\/backend\/native\/hardness-addon\/build\/Release\/.+\.(iobj|ipdb|pdb|exp|lib|obj)$/,
      /^\/backend\/native\/hardness-addon\/build\/Release\/obj($|\/)/,
      /^\/backend\/native\/hardness-addon\/build\/Release\/nothing\.lib$/,
      /^\/backend\/native\/hardness-addon\/binding\.gyp$/,
      /^\/backend\/native\/hardness-addon\/package(-lock)?\.json$/,
      /^\/backend\/native\/hardness-addon\/README\.md$/,
      // serial-addon excluded entirely per packaging decision.
      /^\/native($|\/)/,
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
        // Installer/app icon: drop build/icon.ico in the repo and uncomment
        // the blocks below. Without these electron-builder uses NSIS defaults.
        // win: { icon: 'build/icon.ico' },
        // nsis: {
        //   installerIcon: 'build/icon.ico',
        //   uninstallerIcon: 'build/icon.ico',
        // },
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
