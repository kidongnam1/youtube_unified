Option Explicit

Dim shell, fso, root, launch, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
launch = root & "\YouTube_Unified_Launcher.py"

' pythonw 우선, 없으면 pyw, 마지막으로 python
cmd = "cmd /c (where pythonw >nul 2>nul && start """" /b pythonw """ & launch & """) || " & _
      "(where pyw >nul 2>nul && start """" /b pyw """ & launch & """) || " & _
      "(start """" /b python """ & launch & """)"
shell.Run cmd, 0, False
