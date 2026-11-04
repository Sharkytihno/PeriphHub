; Hooks de l'installeur NSIS (bundle.windows.nsis.installerHooks dans tauri.conf.json).
;
; Mise à jour intégrée : PeriphHub lance l'installeur (/P /UPDATE /R) puis se ferme aussitôt.
; L'installeur de Tauri demande ensuite au Restart Manager de fermer tout processus qui utilise
; periphhub.exe ; si l'ancien PeriphHub est encore en train de se fermer (WebView2, appareil USB
; qui ne rend pas la main…), Windows refuse de le terminer et l'installeur abandonnait avec
; « La fermeture de PeriphHub a échoué. Veuillez fermer l'application et réessayer. »
;
; Ici, AVANT cette vérification et seulement en mise à jour :
;   1. on attend jusqu'à 15 s que periphhub.exe soit libéré (le cas normal : quelques dixièmes de s) ;
;   2. s'il est toujours verrouillé, on le RENOMME (Windows l'autorise pour un programme en cours) :
;      le nouveau s'installe à côté, l'ancien processus finit de se fermer tout seul, et PeriphHub
;      supprime les fichiers « .old » à son prochain lancement.
; Ce hook est dans l'installeur de la NOUVELLE version : il protège aussi les mises à jour lancées
; depuis une ancienne version.

!macro PH_FREE_FILE path
  ClearErrors
  FileOpen $1 "${path}" a
  ${IfNot} ${Errors}
    FileClose $1
  ${Else}
    ; verrouillé : on l'écarte sous un autre nom (un .old d'une mise à jour précédente peut
    ; lui-même être encore verrouillé, d'où les noms de secours)
    Delete "${path}.old"
    ClearErrors
    Rename "${path}" "${path}.old"
    ${If} ${Errors}
      Delete "${path}.old2"
      ClearErrors
      Rename "${path}" "${path}.old2"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    Push $0
    Push $1
    StrCpy $0 0
    ph_wait:
      IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 ph_done
      ClearErrors
      FileOpen $1 "$INSTDIR\${MAINBINARYNAME}.exe" a
      IfErrors ph_locked
      FileClose $1
      Goto ph_done
    ph_locked:
      IntOp $0 $0 + 1
      IntCmp $0 30 ph_force 0 ph_force
      Sleep 500
      Goto ph_wait
    ph_force:
      !insertmacro PH_FREE_FILE "$INSTDIR\${MAINBINARYNAME}.exe"
    ph_done:
    ; HeadsetControl (lancé par PeriphHub pour les casques) : même traitement, sans attente
    ${If} ${FileExists} "$INSTDIR\resources\headsetcontrol.exe"
      !insertmacro PH_FREE_FILE "$INSTDIR\resources\headsetcontrol.exe"
    ${EndIf}
    Pop $1
    Pop $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Éclairage de la mémoire activé (service OpenRGB de PeriphHub, src-tauri/src/openrgb_service.rs) :
  ; PeriphHub le retire lui-même, avec une validation Windows, tant que son exe est encore là.
  ; Jamais en mise à jour : le service continue avec la nouvelle version.
  ${If} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$PROGRAMFILES64\PeriphHub-OpenRGB\OpenRGB.exe"
    ExecShellWait "runas" "$INSTDIR\${MAINBINARYNAME}.exe" "--openrgb-service uninstall" SW_HIDE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; « Démarrer avec Windows » (option de PeriphHub) : rien ne doit survivre à la désinstallation,
  ; sauf en mise à jour (l'installeur désinstalle l'ancienne version avant d'installer la nouvelle)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PeriphHub"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "PeriphHub"
    ; Journal des erreurs internes : inutile sans PeriphHub. Le journal d'allègement (allegement.json)
    ; reste, pour pouvoir annuler l'allègement après une réinstallation ; dossier retiré s'il est vide.
    Delete "$LOCALAPPDATA\PeriphHub\erreurs.log"
    RMDir "$LOCALAPPDATA\PeriphHub"
  ${EndIf}
  Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
  Delete "$INSTDIR\${MAINBINARYNAME}.exe.old2"
  Delete "$INSTDIR\resources\headsetcontrol.exe.old"
  Delete "$INSTDIR\resources\headsetcontrol.exe.old2"
!macroend
