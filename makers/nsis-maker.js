const path = require('path');
const MakerBase = require('@electron-forge/maker-base').default;
const { build, Platform, Arch } = require('electron-builder');

class MakerNSIS extends MakerBase {
  name = 'nsis';
  defaultPlatforms = ['win32'];

  isSupportedOnCurrentPlatform() {
    return process.platform === 'win32';
  }

  async make({ dir, makeDir, appName, packageJSON, targetArch }) {
    const outDir = path.resolve(makeDir, 'nsis', `win32-${targetArch}`);
    await this.ensureDirectory(outDir);

    const archMap = { x64: Arch.x64, ia32: Arch.ia32, arm64: Arch.arm64 };
    const builderArch = archMap[targetArch] || Arch.x64;

    const cfg = this.config || {};

    // Wire in our customInstall NSH so vc_redist.x64.exe runs during install.
    // electron-builder copies `nsis.include` into its NSIS scripts at compile
    // time and emits the !macro customInstall hook automatically.
    const nsisInclude = path.resolve(__dirname, '..', 'build', 'installer.nsh');

    await build({
      prepackaged: dir,
      targets: Platform.WINDOWS.createTarget('nsis', builderArch),
      config: {
        appId: cfg.appId || `com.${(packageJSON.name || 'app').toLowerCase()}.app`,
        productName: cfg.productName || appName,
        directories: { output: outDir },
        win: cfg.win,
        nsis: {
          oneClick: cfg.oneClick ?? false,
          allowToChangeInstallationDirectory: cfg.allowToChangeInstallationDirectory ?? true,
          perMachine: cfg.perMachine ?? false,
          shortcutName: cfg.shortcutName || appName,
          include: nsisInclude,
          ...cfg.nsis,
        },
      },
    });

    return [path.join(outDir, `${cfg.productName || appName} Setup ${packageJSON.version}.exe`)];
  }
}

module.exports = MakerNSIS;
module.exports.default = MakerNSIS;
