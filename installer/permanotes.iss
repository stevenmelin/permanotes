; PermaNotes Windows installer (Inno Setup 6). Built by windows\Build Windows Installer.bat
#ifndef MyAppVersion
  #define MyAppVersion "1.0.13"
#endif
#define MyAppName "PermaNotes"
#define MyAppExe "PermaNotes.exe"

[Setup]
AppId={{8C1E3D2A-6F4B-4E57-9A3C-5B1D7E9F2A64}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Steven Melin
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=PermaNotes-{#MyAppVersion}-Windows-Setup
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#MyAppExe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ChangesAssociations=yes
CloseApplications=no
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\docs\README.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\PermaNotes"; Filename: "{app}\{#MyAppExe}"
Name: "{group}\PermaNotes README"; Filename: "{app}\README.txt"
Name: "{group}\Uninstall PermaNotes"; Filename: "{uninstallexe}"
Name: "{autodesktop}\PermaNotes"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Registry]
; Double-click .pn files to open them in PermaNotes
Root: HKA; Subkey: "Software\Classes\.pn"; ValueType: string; ValueName: ""; ValueData: "PermaNotes.File"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\PermaNotes.File"; ValueType: string; ValueName: ""; ValueData: "PermaNotes File"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\PermaNotes.File\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExe},0"
Root: HKA; Subkey: "Software\Classes\PermaNotes.File\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Open PermaNotes now"; Flags: nowait postinstall skipifsilent

[Code]
// Close a running PermaNotes before installing/uninstalling, so Setup never has to ask.
procedure CloseRunningPermaNotes();
var
  Code: Integer;
begin
  // ask it to close normally first (saves any last edit)...
  if Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM PermaNotes.exe /T', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then
    Sleep(2500);
  // ...then make sure nothing is left behind
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM PermaNotes.exe /T', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CloseRunningPermaNotes();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  CloseRunningPermaNotes();
  Result := True;
end;
