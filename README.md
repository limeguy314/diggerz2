# diggerz2

Client **build 22.11** + Node WebSocket server (flat layout).

## Files
- `index.html` — diggerz client (hosted mode → same host WebSocket)
- `index.js` — HTTP static + WebSocket
- `room.js` — multiplayer (spawn peers, movement, shared dig, weapons)
- `packet.js` / `player.js` / `world.js` — protocol helpers
- `package.json` / `render.yaml`

## Run locally
```bash
npm install
npm start
```
Open http://localhost:10000/

## Render
1. Web Service → this repo
2. Build: `npm install` · Start: `npm start` · Health: `/health`
3. Open https://YOUR-SERVICE.onrender.com/

## Query params
| URL | Behavior |
|-----|----------|
| `/` | Remote server on this host |
| `/?local=1` | In-browser Dig+Trade only |
| `/?server=other.host` | Force another WS host |

## Multiplayer
Join from two browsers. Type `/name YourName` in chat to set your label.
