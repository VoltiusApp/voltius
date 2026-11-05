!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path add "$INSTDIR"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$INSTDIR\voltius-cli.exe" __path remove "$INSTDIR"'
!macroend
