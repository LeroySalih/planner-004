#!/bin/bash

# 1. Update build/version number
echo "Updating version number..."
npm version patch --no-git-tag-version

# 2. Run the build
echo "Starting npm run build..."
if npm run build; then
    echo "Build successful! Proceeding to Git operations..."
    
    # 3. Git Add, Commit, and Push
    git add .
    git commit -m "Daily Build: $(date +'%Y-%m-%d %H:%M')"
    
    echo "Pushing to remote..."
    if git push; then
        echo "Deployment complete!"
    else
        echo "Error: Git push failed. Check your internet or permissions."
        exit 1
    fi
else
    echo "Error: Build failed. Aborting deployment to prevent breaking production."
    exit 1
fi