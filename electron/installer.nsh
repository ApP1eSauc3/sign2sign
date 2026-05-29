; Windows NSIS script — registers the sign2sign:// protocol handler so Google
; OAuth can redirect back to the Electron app after authentication.
;
; Included by electron-builder via nsis.include in electron-builder.yml.
; Runs as part of the installer/uninstaller — do not add business logic here.

; ── Register protocol on install ──────────────────────────────────────────────
!macro customInstall
  ; HKCU so no admin rights are needed — the key applies to the current user only
  WriteRegStr HKCU "Software\Classes\sign2sign" "" "URL:Sign2Sign Protocol"
  WriteRegStr HKCU "Software\Classes\sign2sign" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\sign2sign\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\sign2sign\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

; ── Remove protocol on uninstall ──────────────────────────────────────────────
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\sign2sign"
!macroend
