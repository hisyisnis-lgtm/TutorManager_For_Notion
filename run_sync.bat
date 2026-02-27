@echo off
"C:\Program Files\nodejs\node.exe" "c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\sync_student_status.mjs" >> "c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\sync_log.txt" 2>&1
"C:\Program Files\nodejs\node.exe" "c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\check_conflicts.mjs" >> "c:\Users\sooji\OneDrive\문서\GitHub\TutorManager_For_Notion\sync_log.txt" 2>&1
