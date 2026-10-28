Dim fso, bridgeRoot, shell
Set fso = CreateObject("Scripting.FileSystemObject")
bridgeRoot = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & bridgeRoot & "\scripts\BrowserBridge.ps1"" status", 0, False
