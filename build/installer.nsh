; installer.nsh — wired into electron-builder via `nsis.include` in
; makers/nsis-maker.js. Runs at install time inside the customInstall hook.
;
; Two responsibilities:
;
; 1. ALWAYS install the Microsoft VC++ 2015-2022 x64 redistributable. The
;    native addons (hardness_addon.node, serialport, better-sqlite3) need it
;    and Windows doesn't always ship a matching version. Idempotent / fast
;    when already installed, so unconditional is simpler than detection.
;
; 2. CONDITIONALLY install per-camera vendor drivers. We scan
;    $INSTDIR\resources\installers\<vendor>\ for a setup .exe (the first one
;    we find per folder). For each found installer we MessageBox-prompt the
;    user "Install <vendor> camera driver now?" and ExecWait it silently if
;    they accept. Empty subfolders (the .gitkeep'd scaffold case) are
;    skipped silently — the build does not require the EXEs to be present.
;
; Exit codes we treat as success for any chained installer:
;   0    — installed
;   1638 — newer version already installed
;   3010 — installed, reboot recommended

!macro InstallVendorDriver vendorLabel vendorFolder
  Push $R0
  Push $R1
  ; FindFirst gives us $R0 = handle, $R1 = first filename matching mask.
  FindFirst $R0 $R1 "$INSTDIR\resources\installers\${vendorFolder}\*.exe"
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    DetailPrint "[driver-install] ${vendorLabel} installer found: $R1"
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Install the ${vendorLabel} camera driver now?$\r$\n$\r$\nFile: $R1$\r$\n$\r$\nClick No to skip; you can run the installer later from the app's resources folder." \
      /SD IDYES IDNO skip_${vendorFolder}
      ExecWait '"$INSTDIR\resources\installers\${vendorFolder}\$R1" /S' $R0
      ${If} $R0 = 0
        DetailPrint "[driver-install-success] ${vendorLabel}"
      ${ElseIf} $R0 = 1638
        DetailPrint "[driver-install-success] ${vendorLabel} already up to date"
      ${ElseIf} $R0 = 3010
        DetailPrint "[driver-install-success] ${vendorLabel} (reboot recommended)"
      ${Else}
        DetailPrint "[driver-install-failed] ${vendorLabel} exit=$R0"
      ${EndIf}
      Goto done_${vendorFolder}
    skip_${vendorFolder}:
      DetailPrint "[driver-install] ${vendorLabel} skipped by user"
    done_${vendorFolder}:
  ${Else}
    DetailPrint "[driver-install] ${vendorLabel} no installer present — skipped"
  ${EndIf}
  ${If} $R0 != ""
    FindClose $R0
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  DetailPrint "[driver-install] VC++ 2015-2022 x64 Redistributable"
  ExecWait '"$INSTDIR\resources\redist\vc_redist.x64.exe" /install /quiet /norestart' $0
  ${If} $0 = 0
    DetailPrint "[driver-install-success] VC++ redistributable"
  ${ElseIf} $0 = 1638
    DetailPrint "[driver-install-success] VC++ redistributable already up to date"
  ${ElseIf} $0 = 3010
    DetailPrint "[driver-install-success] VC++ redistributable (reboot recommended)"
  ${Else}
    DetailPrint "[driver-install-failed] VC++ redistributable exit=$0 (continuing)"
  ${EndIf}

  ; Per-camera driver installers — each is conditional on the EXE being
  ; present under resources/installers/<vendor>/. Order is alphabetical;
  ; add more lines as new vendor folders are introduced.
  !insertmacro InstallVendorDriver "Do3Think BasedCam3"       "BasedCam3"
  !insertmacro InstallVendorDriver "Do3Think DVP2"            "DVP2"
  !insertmacro InstallVendorDriver "GigE Vision"              "GigE"
  !insertmacro InstallVendorDriver "USB3 Vision"              "USB3Vision"
!macroend
