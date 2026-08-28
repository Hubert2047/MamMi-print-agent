# Build the Windows Print Agent

Run these commands on the development machine from `print-agent`:

```powershell
npm install
npm run build:windows
```

The build creates `dist/mammi-print-agent.exe`. Copy this executable, `install-startup-task.ps1`, and a separate `.env` file to the production Windows computer. The `.env` is loaded from the executable directory, so `BACKEND_URL`, `AGENT_ID`, and `AGENT_TOKEN` can be changed without rebuilding.

On production, install the startup task from the directory containing the executable and `.env`:

```powershell
.\install-startup-task.ps1
```

Node.js and npm are required only on the development machine. The production machine still needs the Windows printer driver installed.
