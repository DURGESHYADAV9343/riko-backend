#!/bin/bash
# Render startup script

echo "🚀 Starting Riko AI Backend..."

# Install dependencies
pip install -r requirements.txt

# Start server with gunicorn
gunicorn server:app --bind 0.0.0.0:$PORT --workers 2 --worker-class uvicorn.workers.UvicornWorker --timeout 120
