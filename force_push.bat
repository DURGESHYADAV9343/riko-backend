@echo off
echo ===================================
echo   FORCE PUSHING TO GITHUB (RENDER)
echo ===================================

cd /d "e:\ai assitance\jarvis"

:: Add all changes
git add .

:: Commit
git commit -m "Fix background and timeout - Force Push"

:: Push
echo Pushing code... please wait...
git push origin main

echo ===================================
echo   DONE! Render will update in 2 mins.
echo   Check your Mobile App after 2 mins.
echo ===================================
pause
