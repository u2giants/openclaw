---
description: Deployment workflow and SSH server rules
---
When asked to deploy, fix a server bug, or check the Coolify server, you MUST strictly follow this workflow:

1. **NO LIVE SERVER EDITS:** Never modify configuration files or scripts directly on the live server via SSH.
2. **Local Edits First:** All code modifications must be done within the local repository workspace (`d:\openclaw\openclaw-src\openclaw`).
3. **Deploy via GitHub:** 
// turbo
Run the following commands to commit and push the changes:
`git add .`
`git commit -m "update"` 
`git push origin main`
4. **Monitor the Deploy:** Allow Coolify to automatically pull the changes and restart the environment.
5. **Use Existing SSH Sessions:** If you need to inspect logs or check server status, do NOT start a new `ssh` command. You must use `send_command_input` to pass commands into the persistent SSH terminal that is already running.
