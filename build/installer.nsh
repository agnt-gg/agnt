; =========================================================================
; AGNT custom NSIS hooks.
;
; WHY THIS FILE IS NOT EMPTY ANY MORE
; -----------------------------------
; A Windows "update" is not an in-place patch. electron-builder's installer
; runs the PREVIOUS version's uninstaller first, and that uninstaller's
; default behaviour is `RMDir /r $INSTDIR` — it erases the install directory
; wholesale, with no prompt and no Recycle Bin. A user who installed AGNT to
; D:\AGNT and kept his project files in D:\AGNT\projects lost all of them to
; exactly that, on 2026-08-09. Nothing he did was unreasonable; we simply
; never told the installer that a user's files might be standing where it
; was about to demolish.
;
; Three defences, layered (each covers a case the others cannot):
;
;   1. customRemoveFiles  — the uninstaller deletes ONLY what we installed.
;                           Protects every future update and uninstall, for
;                           every install shipped from this version onward,
;                           including silent/auto updates.
;   2. .onVerifyInstDir   — the installer refuses to target a folder that
;                           already contains someone's files. Prevents new
;                           installs from creating the hazard. GUI-only by
;                           NSIS design (silent installs skip the directory
;                           page) — which is acceptable because layer 1
;                           protects whatever a silent install targets.
;   3. rescue page        — when UPDATING an install whose folder contains
;                           foreign files (the pre-guard population: AGNT
;                           already in D:\AGNT with projects next to it),
;                           offer to move those files to a sibling folder
;                           BEFORE the old, blind uninstaller runs. This is
;                           the only protection the existing population gets
;                           on their FIRST update to this version, because
;                           the uninstaller that runs during that update is
;                           the OLD one — ours only takes over afterwards.
;
; TESTS: build/nsis-tests/ compiles THIS FILE into a harness and exercises
; every macro against real directories. Run build/nsis-tests/run-tests.bat.
; The end-to-end install/update/uninstall matrix runs in Windows Sandbox:
; build/nsis-tests/sandbox/.
; =========================================================================

!include "LogicLib.nsh"

; Real builds get these from common.nsh, which electron-builder includes
; AFTER this file. The fallbacks may therefore only exist when compiling the
; test harness (harness.nsi defines AGNT_HARNESS): an unconditional !ifndef
; here fires in the real build too, and common.nsh's own !define then dies
; with "already defined" — which is exactly how the first packaging attempt
; of this file failed. Harness-scoped or nothing.
!ifdef AGNT_HARNESS
  !ifndef APP_EXECUTABLE_FILENAME
    !define APP_EXECUTABLE_FILENAME "AGNT.exe"
  !endif
  !ifndef UNINSTALL_FILENAME
    !define UNINSTALL_FILENAME "Uninstall AGNT.exe"
  !endif
!endif

; -------------------------------------------------------------------------
; AGNT_CLASSIFY_ENTRY — is this top-level entry OUR payload, or someone's?
;
;   in:  $R7 = entry name (no path), $R8 = "d" for directory, "f" for file
;   out: $R9 = "ours" | "foreign"
;
; The rule: "ours" must be provably ours. Electron's top-level payload is a
; small closed set — three directories and a fixed cast of runtime files.
; Extensions dll/pak/bin are Chromium runtime artifacts that are never user
; data at the top of an app directory; everything else must match by EXACT
; name. Notably .dat and .exe are NOT matched by extension: "backup.dat" or
; "my-tool.exe" at the top level are someone's property. The cost of this
; conservatism is that a future Electron may add a file we leave behind as
; a stale orphan; the cost of the alternative is deleting a person's work.
; Orphans are free. Work is not.
; -------------------------------------------------------------------------
!macro AGNT_CLASSIFY_ENTRY
  StrCpy $R9 "foreign"
  ${If} $R8 == "d"
    ${If} $R7 == "resources"
    ${OrIf} $R7 == "locales"
    ${OrIf} $R7 == "swiftshader"
      StrCpy $R9 "ours"
    ${EndIf}
  ${Else}
    ; Extract the extension into $R5 ("" when there is none).
    StrCpy $R5 ""
    StrLen $R4 $R7
    ${Do}
      IntOp $R4 $R4 - 1
      ${If} $R4 < 0
        ${ExitDo}
      ${EndIf}
      StrCpy $R3 $R7 1 $R4
      ${If} $R3 == "."
        IntOp $R2 $R4 + 1
        StrCpy $R5 $R7 "" $R2
        ${ExitDo}
      ${EndIf}
    ${Loop}

    ${If} $R5 == "dll"
    ${OrIf} $R5 == "pak"
    ${OrIf} $R5 == "bin"
      StrCpy $R9 "ours"
    ${ElseIf} $R7 == "${APP_EXECUTABLE_FILENAME}"
    ${OrIf} $R7 == "${UNINSTALL_FILENAME}"
    ${OrIf} $R7 == "icudtl.dat"
    ${OrIf} $R7 == "vk_swiftshader_icd.json"
    ${OrIf} $R7 == "LICENSE.electron.txt"
    ${OrIf} $R7 == "LICENSES.chromium.html"
    ${OrIf} $R7 == "chrome_crashpad_handler.exe"
    ${OrIf} $R7 == "install.log"
    ${OrIf} $R7 == "uninstall.log"
    ${OrIf} $R7 == "debug.log"
      StrCpy $R9 "ours"
    ${EndIf}
  ${EndIf}
!macroend

; -------------------------------------------------------------------------
; AGNT_DIR_IS_ACCEPTABLE — may the installer target this directory?
;
;   in:  DIR (macro arg, may be a $variable)
;   out: $R9 = "yes" | "no"
;
; yes: directory missing (installer creates it), empty, or holding an AGNT
;      install already (upgrade in place — including a half-removed one that
;      only kept its uninstaller).
; no:  it holds entries and none of them are ours. Installing here would
;      put a demolition zone around someone's files.
;
; The empty test enumerates and skips "." / ".." explicitly. The tempting
; one-liner — IfFileExists "$DIR\*.*" — matches those pseudo-entries and
; calls a perfectly empty directory "occupied", which would grey out Next
; for anyone who pre-created their install folder. That defect was caught
; by the harness before this file ever shipped; keep the harness honest.
; -------------------------------------------------------------------------
!macro AGNT_DIR_IS_ACCEPTABLE DIR
  StrCpy $R9 "yes"
  ${If} ${FileExists} "${DIR}\${APP_EXECUTABLE_FILENAME}"
  ${OrIf} ${FileExists} "${DIR}\${UNINSTALL_FILENAME}"
    ; ours already — allow the upgrade
  ${ElseIf} ${FileExists} "${DIR}\*.*"
    FindFirst $R1 $R7 "${DIR}\*.*"
    ${Do}
      ${If} $R7 == ""
        ${ExitDo}
      ${EndIf}
      ${If} $R7 != "."
      ${AndIf} $R7 != ".."
        StrCpy $R9 "no"
        ${ExitDo}
      ${EndIf}
      FindNext $R1 $R7
    ${Loop}
    FindClose $R1
  ${EndIf}
!macroend

; -------------------------------------------------------------------------
; AGNT_COUNT_FOREIGN — how many top-level entries are not ours?
;
;   in:  DIR
;   out: $9 = count, $8 = name of the first foreign entry ("" if none)
; -------------------------------------------------------------------------
!macro AGNT_COUNT_FOREIGN DIR
  StrCpy $9 0
  StrCpy $8 ""
  FindFirst $R1 $R7 "${DIR}\*.*"
  ${Do}
    ${If} $R7 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R7 != "."
    ${AndIf} $R7 != ".."
      ${If} ${FileExists} "${DIR}\$R7\*.*"
        StrCpy $R8 "d"
      ${Else}
        StrCpy $R8 "f"
      ${EndIf}
      !insertmacro AGNT_CLASSIFY_ENTRY
      ${If} $R9 == "foreign"
        ${If} $9 = 0
          StrCpy $8 "$R7"
        ${EndIf}
        IntOp $9 $9 + 1
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R7
  ${Loop}
  FindClose $R1
!macroend

; -------------------------------------------------------------------------
; AGNT_MOVE_FOREIGN — relocate every foreign entry out of harm's way.
;
;   in:  DIR, DEST
;   out: $9 = moved count, $6 = failed count
;
; Rename is instantaneous on the same volume, which DIR and DEST always are
; (DEST is a sibling of DIR). Mutating the directory during FindNext
; iteration follows the precedent of electron-builder's own un.atomicRMDir,
; which renames entries out of $INSTDIR inside the same loop shape.
; -------------------------------------------------------------------------
!macro AGNT_MOVE_FOREIGN DIR DEST
  StrCpy $9 0
  StrCpy $6 0
  CreateDirectory "${DEST}"
  FindFirst $R1 $R7 "${DIR}\*.*"
  ${Do}
    ${If} $R7 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R7 != "."
    ${AndIf} $R7 != ".."
      ${If} ${FileExists} "${DIR}\$R7\*.*"
        StrCpy $R8 "d"
      ${Else}
        StrCpy $R8 "f"
      ${EndIf}
      !insertmacro AGNT_CLASSIFY_ENTRY
      ${If} $R9 == "foreign"
        ClearErrors
        Rename "${DIR}\$R7" "${DEST}\$R7"
        ${If} ${Errors}
          IntOp $6 $6 + 1
        ${Else}
          IntOp $9 $9 + 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R7
  ${Loop}
  FindClose $R1
!macroend

; -------------------------------------------------------------------------
; AGNT_DELETE_OURS — delete OUR payload, leave everything else standing.
; -------------------------------------------------------------------------
!macro AGNT_DELETE_OURS DIR
  FindFirst $R1 $R7 "${DIR}\*.*"
  ${Do}
    ${If} $R7 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R7 != "."
    ${AndIf} $R7 != ".."
      ${If} ${FileExists} "${DIR}\$R7\*.*"
        StrCpy $R8 "d"
      ${Else}
        StrCpy $R8 "f"
      ${EndIf}
      !insertmacro AGNT_CLASSIFY_ENTRY
      ${If} $R9 == "ours"
        ${If} $R8 == "d"
          RMDir /r "${DIR}\$R7"
        ${Else}
          Delete "${DIR}\$R7"
        ${EndIf}
      ${EndIf}
    ${EndIf}
    FindNext $R1 $R7
  ${Loop}
  FindClose $R1
!macroend

; =========================================================================
; LAYER 1 — customRemoveFiles
;
; Replaces the template's file-removal block (un.atomicRMDir + RMDir /r
; $INSTDIR) for BOTH updates and real uninstalls. In neither case is it
; acceptable to delete files we did not install; on uninstall, Windows
; convention is to leave user-created content behind anyway.
;
; What this deliberately gives up: the template's move-aside-then-restore
; rollback for busy files. The app-running check has already executed by
; the time this runs; if the main executable still cannot be deleted we
; abort exactly as the template's busy-file path did, and the installer
; surfaces the failure. What we will not do is buy rollback convenience
; with a recursive delete of a folder we do not fully own.
;
; The trailing bare RMDir removes $INSTDIR only when it is empty — i.e.
; only when nothing of the user's survived to need it. SetOutPath first:
; the uninstaller's own CWD sits in $INSTDIR (un.onInit does SetOutPath
; $INSTDIR) and a process's CWD cannot be deleted out from under it.
; =========================================================================
!macro customRemoveFiles
  SetOutPath $TEMP
  !insertmacro AGNT_DELETE_OURS "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Abort "Cannot remove $INSTDIR\${APP_EXECUTABLE_FILENAME} — is AGNT still running?"
  ${EndIf}
  RMDir "$INSTDIR"
!macroend

; =========================================================================
; LAYERS 2 & 3 live inside customHeader, and the placement is load-bearing:
; electron-builder includes THIS FILE before common.nsh, but customHeader is
; inserted into installer.nsi AFTER common.nsh. Functions compile where they
; are inserted, and these reference ${APP_EXECUTABLE_FILENAME} /
; ${UNINSTALL_FILENAME}, which common.nsh defines. Compiled at include time
; instead, NSIS leaves the unknown ${...} as LITERAL TEXT — no error — and
; the guard would look for a file literally named ${APP_EXECUTABLE_FILENAME},
; never find it, and refuse every legitimate upgrade. Macros (the AGNT_*
; family above) are immune: their bodies expand at !insertmacro time.
; =========================================================================
!macro customHeader

; The template compiles this script TWICE — the second pass (with
; BUILD_UNINSTALLER defined) produces the uninstaller, where the assisted-
; installer pages do not exist. An install function compiled there is
; unreferenced, and makensis' warning 6010 is promoted to an error by
; electron-builder. Layers 2 and 3 are installer-side by definition; the
; uninstaller's protection is layer 1, whose macro expands only where it
; is inserted.
!ifndef BUILD_UNINSTALLER

; -------------------------------------------------------------------------
; LAYER 2 — .onVerifyInstDir
;
; NSIS calls this every time the directory-page selection changes; Abort
; greys out Next. Silent installs never show the page, so this guard is
; UI-only — layer 1 covers whatever a silent install targets.
; -------------------------------------------------------------------------
Function .onVerifyInstDir
  !insertmacro AGNT_DIR_IS_ACCEPTABLE "$INSTDIR"
  ${If} $R9 == "no"
    Abort
  ${EndIf}
FunctionEnd

; -------------------------------------------------------------------------
; LAYER 3 — the rescue page.
;
; Runs immediately after the directory page (customPageAfterChangeDir slot).
; Relevant only when $INSTDIR already holds an AGNT install AND foreign
; files: precisely the population created before these guards existed. On
; their FIRST update to this version the uninstaller that runs is still the
; old, blind one — this prompt is the only thing standing between their
; files and it.
;
; The page never actually renders: the pre-callback does the work with
; MessageBoxes and then Aborts, which skips the page. Both boxes carry /SD
; defaults so a hypothetical silent run through this path stays safe.
;
; Decline flow: a second, sterner confirmation, then Quit (nothing has been
; touched at that point) or proceed with informed consent.
; -------------------------------------------------------------------------
Var agntRescueDest

Function agntRescuePagePre
  ; Only an update-in-place of an existing install is our business here.
  ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${IfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      Abort
    ${EndIf}
  ${EndIf}

  !insertmacro AGNT_COUNT_FOREIGN "$INSTDIR"
  ${If} $9 = 0
    Abort
  ${EndIf}

  ; Pick a sibling rescue folder that does not collide.
  StrCpy $agntRescueDest "$INSTDIR-rescued"
  ${If} ${FileExists} "$agntRescueDest\*.*"
    StrCpy $R2 1
    ${Do}
      IntOp $R2 $R2 + 1
      StrCpy $agntRescueDest "$INSTDIR-rescued-$R2"
      ${IfNot} ${FileExists} "$agntRescueDest\*.*"
        ${ExitDo}
      ${EndIf}
      ${If} $R2 > 99
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONEXCLAMATION \
    "This folder contains $9 item(s) that are not part of AGNT (for example: $\"$8$\").$\r$\n$\r$\nUpdating AGNT replaces everything in:$\r$\n$INSTDIR$\r$\n$\r$\nMove your files to safety first?$\r$\n$\r$\nThey will be moved to:$\r$\n$agntRescueDest" \
    /SD IDYES IDNO agnt_rescue_declined

  !insertmacro AGNT_MOVE_FOREIGN "$INSTDIR" "$agntRescueDest"
  ${If} $6 > 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "$6 item(s) could not be moved (a file may be open in another program). Anything left in $INSTDIR will be deleted by the update." \
      /SD IDOK
  ${Else}
    MessageBox MB_OK \
      "Done — $9 item(s) moved to:$\r$\n$agntRescueDest" \
      /SD IDOK
  ${EndIf}
  Abort

  agnt_rescue_declined:
  MessageBox MB_YESNO|MB_ICONSTOP \
    "Continue WITHOUT moving them?$\r$\n$\r$\nEverything in $INSTDIR that is not part of AGNT will be PERMANENTLY DELETED by this update. There is no Recycle Bin for this." \
    /SD IDYES IDYES agnt_rescue_proceed
  Quit

  agnt_rescue_proceed:
  Abort
FunctionEnd

!endif ; BUILD_UNINSTALLER

!macroend

!macro customPageAfterChangeDir
  Page custom agntRescuePagePre
!macroend

; =========================================================================
; agnt:// URL SCHEME
;
; WHY THIS IS HAND-WRITTEN AND NOT `build.protocols`
; -------------------------------------------------
; electron-builder honours `protocols` on macOS (Info.plist CFBundleURLTypes)
; and on Linux (desktop-file MimeType), and NOT on Windows: there is not one
; reference to it anywhere under app-builder-lib/out/targets/nsis. Setting the
; key and assuming three platforms were covered would leave Windows — the
; majority of installs — silently without a handler.
;
; HKCU, NOT HKLM/HKCR, EVEN FOR A PER-MACHINE INSTALL
; ---------------------------------------------------
; electron-builder's NSIS templates define no shell-context variable (no SHCTX),
; so there is nothing to follow the install mode with. Per-user is the safer
; default of the two: it needs no elevation, it cannot collide with another
; product's machine-wide claim, and it is scoped to the person who chose to
; install AGNT. On a per-machine install a SECOND user on the same PC gets the
; scheme the first time they run AGNT, because main.js re-registers on every
; launch — the two layers cover each other.
;
; The runtime registration is also what makes an unpackaged dev build testable,
; and what lets a reinstall take the scheme back from one.
; =========================================================================
!macro AGNT_REGISTER_PROTOCOL
  ; "URL Protocol" must exist and must be EMPTY — its presence is the flag
  ; Windows reads to decide a key is a URL scheme; its value is never used.
  WriteRegStr HKCU "Software\Classes\agnt" "" "URL:AGNT Protocol"
  WriteRegStr HKCU "Software\Classes\agnt" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\agnt\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  ; "%1" stays quoted. Unquoted, a URL containing a space is split across argv
  ; and the app receives a truncated link — and worse, everything after the
  ; space arrives as separate arguments of our own process.
  WriteRegStr HKCU "Software\Classes\agnt\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

; =========================================================================
; Original hook, preserved: ASAR is enabled; nothing to clean at install.
; =========================================================================
!macro customInstall
  ; ASAR is now enabled - do not delete app.asar files
  ; The old cleanup code was removed because we now use ASAR packaging
  !insertmacro AGNT_REGISTER_PROTOCOL
!macroend

; =========================================================================
; Leave nothing behind pointing at an executable that is gone.
;
; A stale handler is not cosmetic: Windows keeps offering the association, and
; clicking a link produces a failure with no explanation. Deleted only if it
; still names OUR install directory — if the user has since installed AGNT
; somewhere else, that install now owns the scheme and this uninstall must not
; break it.
; =========================================================================
!macro customUnInstall
  ReadRegStr $R0 HKCU "Software\Classes\agnt\shell\open\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    DeleteRegKey HKCU "Software\Classes\agnt"
  ${EndIf}
!macroend
