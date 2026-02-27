Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c """"C:\Program Files\nodejs\node.exe"""" """"c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\check_conflicts_daemon.mjs"""" >> """"c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\sync_log.txt"""" 2>&1", 0, False
Set WshShell = Nothing
