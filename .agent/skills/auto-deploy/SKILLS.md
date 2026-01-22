# Auto-Deploy Skill

## Description

This skill automates the versioning, building, and pushing of the project to the
remote repository.

## Capabilities

- Increments the "version" or a custom "build" field in package.json.
- Executes the project build command.
- Commits and pushes changes to Git upon build success.

## Usage Instructions

Trigger this when I say "Deploy the project" or "Run daily build." **Safety
Rule:** If `npm run build` fails, STOP immediately and do not commit or push.
