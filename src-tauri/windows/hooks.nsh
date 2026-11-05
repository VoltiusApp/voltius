!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path add "$INSTDIR"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path remove "$INSTDIR"'
  Pop $0
!macroend
