#!/bin/bash
# Quick deployment script for Render

echo "📦 Committing fixes to Git..."

# Stage all changes
git add server.py Procfile start.sh render.yaml requirements.txt

# Commit with descriptive message
git commit -m "Fix: Resolved backend crash - ModelManager NameError

- Moved ModelManager class definition before usage
- Added Render deployment configuration (Procfile, render.yaml)
- Fixed crash-restart loop on Render
- Server now starts successfully"

# Push to remote
git push origin main

echo "✅ Pushed to GitHub! Render will auto-deploy."
echo "🔍 Check Render dashboard for deployment status."
