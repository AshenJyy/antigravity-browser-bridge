Dim fso, scriptDir, WshShell
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir & "\server"

Dim appData, candidates(3), i, cmd
appData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")

candidates(0) = appData & "\Programs\Python\Launcher\pyw.exe"
candidates(1) = appData & "\Programs\Python\Python313\pythonw.exe"
candidates(2) = "pyw.exe"
candidates(3) = "pythonw.exe"

cmd = ""
For i = 0 To UBound(candidates)
    If fso.FileExists(candidates(i)) Then
        cmd = """" & candidates(i) & """"
        Exit For
    End If
Next
If cmd = "" Then cmd = "pyw"

Dim process, pid, cmdLine
cmdLine = cmd & " """ & scriptDir & "\server\server.py"""
Set process = GetObject("winmgmts:Win32_Process")
process.Create cmdLine, scriptDir & "\server", Nothing, pid
