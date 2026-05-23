; installer.nsh — wired into electron-builder via `nsis.include` in
; makers/nsis-maker.js. Runs the bundled Microsoft VC++ 2015-2022 x64
; redistributable installer silently after our files are extracted, so the
; native addons (hardness_addon.node, serialport, better-sqlite3) have their
; required MSVC v143 runtime present on a fresh Windows PC.
;
; The redist installer is idempotent and fast when the runtime is already
; present, so running it unconditionally is safe and simpler than detecting
; "already installed".
;
; Exit codes worth handling:
;   0    — installed successfully
;   1638 — newer version already installed (treat as success)
;   3010 — installed successfully, reboot required (treat as success)
;   anything else — log and continue, since the app may still work if
;                   the user already has a recent VC++ runtime

!macro customInstall
  DetailPrint "Installing Microsoft VC++ 2015-2022 x64 Redistributable..."
  ExecWait '"$INSTDIR\resources\redist\vc_redist.x64.exe" /install /quiet /norestart' $0
  ${If} $0 = 0
    DetailPrint "VC++ redistributable installed."
  ${ElseIf} $0 = 1638
    DetailPrint "VC++ redistributable already up to date."
  ${ElseIf} $0 = 3010
    DetailPrint "VC++ redistributable installed (reboot recommended)."
  ${Else}
    DetailPrint "VC++ redistributable installer returned $0 (continuing anyway)."
  ${EndIf}
!macroend
