!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path add "$INSTDIR"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path remove "$INSTDIR"'
  Pop $0
!macroend

; Tauri's MSI takes this value as its install folder, so a later MSI would land in the old per-user folder.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "${MANUPRODUCTKEY}" ""
    DeleteRegKey /ifempty SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  ${EndIf}
!macroend
