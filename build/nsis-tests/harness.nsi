; Test harness for build/installer.nsh — compiles THE REAL FILE and drives
; its macros against real directories. No copies of the logic live here; if
; installer.nsh changes behaviour, this harness sees the change.
;
; Usage:
;   harness.exe /S /MODE=verify /TDIR=<dir> /TOUT=<file>   -> ALLOW | REFUSE
;   harness.exe /S /MODE=count  /TDIR=<dir> /TOUT=<file>   -> <n>|<first-foreign>
;   harness.exe /S /MODE=move   /TDIR=<dir> /TDEST=<dir> /TOUT=<file>
;                                                          -> moved=<n> failed=<n>
;   harness.exe /S /MODE=remove /TDIR=<dir> /TOUT=<file>   -> removed
;
; Driven by run-tests.bat, which builds the fixtures and asserts the
; filesystem afterwards.

!define AGNT_HARNESS
Unicode true
Name "agnt-nsh-harness"
OutFile "harness.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions

!include "..\installer.nsh"

Var Mode
Var TDir
Var TDest
Var TOut

Section
  ${GetParameters} $0
  ${GetOptions} $0 "/MODE=" $Mode
  ${GetOptions} $0 "/TDIR=" $TDir
  ${GetOptions} $0 "/TDEST=" $TDest
  ${GetOptions} $0 "/TOUT=" $TOut

  StrCpy $1 "UNKNOWN-MODE"

  ${If} $Mode == "verify"
    !insertmacro AGNT_DIR_IS_ACCEPTABLE "$TDir"
    ${If} $R9 == "yes"
      StrCpy $1 "ALLOW"
    ${Else}
      StrCpy $1 "REFUSE"
    ${EndIf}
  ${ElseIf} $Mode == "count"
    !insertmacro AGNT_COUNT_FOREIGN "$TDir"
    StrCpy $1 "$9|$8"
  ${ElseIf} $Mode == "move"
    !insertmacro AGNT_MOVE_FOREIGN "$TDir" "$TDest"
    StrCpy $1 "moved=$9 failed=$6"
  ${ElseIf} $Mode == "remove"
    StrCpy $INSTDIR "$TDir"
    !insertmacro customRemoveFiles
    StrCpy $1 "removed"
  ${EndIf}

  FileOpen $2 "$TOut" w
  FileWrite $2 "$1"
  FileClose $2
SectionEnd
