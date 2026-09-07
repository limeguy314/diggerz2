# diggerz2

Self-hosted diggerz.io rebuild (client build **22.14**).

## Run locally
```bash
npm install
node index.js
# open http://localhost:10000
```

## Render
Connect this repo → Web Service → Start command: `node index.js`

## Modes
| URL | Mode |
|-----|------|
| `/` | Online (this server) |
| `/?local=1` | Offline Dig+Trade |

## Features (phase 1)
- Connect to this host only (no dead lobby servers)
- Shared world, movement, dig, place, inventory, chat bubbles
- `/name YourName` in chat
