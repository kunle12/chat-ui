#!/bin/bash
# chat-ui deployment script for Debian

set -e

APP_DIR="/var/www/chat-ui"
SERVICE_NAME="chat-ui"

echo "=== Chat UI Deployment Script ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo"
    exit 1
fi

# Create app directory
mkdir -p "$APP_DIR"

# Copy application files (excluding node_modules - will be installed below)
echo "Copying application files..."
rsync -av --exclude='node_modules' --exclude='.git' --exclude='.env' ./ "$APP_DIR/"

# Install dependencies
echo "Installing dependencies..."
cd "$APP_DIR"
npm install --production

# Build the application
echo "Building application..."
npm run build

# Copy environment files (create from example if not exists)
if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$APP_DIR/.env.example" ]; then
        cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    else
        echo "Warning: No .env file found. Please create one in $APP_DIR/"
    fi
fi

if [ ! -f "$APP_DIR/.env.local" ]; then
    echo "Note: No .env.local file found (optional)"
fi

# Set permissions
chown -R www-data:www-data "$APP_DIR"

# Install systemd service
echo "Installing systemd service..."
cp chat-ui.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# Start the service
echo "Starting service..."
systemctl start "$SERVICE_NAME"

echo "=== Deployment complete ==="
echo "Service status: $(systemctl is-active $SERVICE_NAME)"