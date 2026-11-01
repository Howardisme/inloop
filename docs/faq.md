# FAQ

## Why does `npm install` report `EBADENGINE`, or why are Node.js APIs missing at startup?

Check that `node --version` is at least 22.13. After upgrading, open a new terminal and run `npm install` and `npm run build` again in the InLoop source folder.

## Why is the `inloop` command not found?

Run `npm link` again in the InLoop source folder. Check `npm prefix -g` and make sure its executable folder (Windows: the folder itself; macOS/Linux: its `bin` subfolder) is on your `PATH`, then open a new terminal.

## Why is `dist/cli/main.js` missing, or why does the card say it isn't built?

Run `npm run build` in the InLoop source folder, then restart the MCP server.

## Why can't `inloop init` find a Git repository?

Run it inside the repository you want to track; `git rev-parse --show-toplevel` shows where you are. Make sure Git is installed.

## Why doesn't Copilot see the InLoop tools, or why does the server fail to start?

Check that the `mcp.json` VS Code is using has an `inloop` entry and that its Node.js and CLI paths still exist. Read the MCP server output for the error, then restart the server after fixing it. With multiple VS Code profiles, run `inloop init --mcp workspace` in the target repository instead.

## What if Windows PowerShell blocks `npm.ps1` or `inloop.ps1`?

Run `npm.cmd` and `inloop.cmd` instead; there's no need to loosen the execution policy for the whole machine.

[Back to the README](../README.md)
