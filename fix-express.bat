@echo off
echo Fixing Express version compatibility issue...
echo.

echo Removing node_modules...
rmdir /s /q node_modules

echo Removing package-lock.json...
del package-lock.json

echo Installing correct Express version...
npm install

echo.
echo Fix completed! Try running the server again.
pause