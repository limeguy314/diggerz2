# diggerz2

Client **build 22.11** + Node fight server.

## Server fixes
- Fight connect: identity packet (name + **skin tone**)
- **Offline Free Dig items/appearance** via opcode 199 (needs updated index.html inject)
- **Mining** — 2-swing break, better tile targeting
- Peers + shared terrain + weapons

## Deploy
1. Ensure `room.js` / `player.js` / `index.js` are latest on main
2. Upload latest **index.html** from release zip (profile inject is in the client)
3. Render → Manual Deploy

## Local
```bash
npm install && npm start
```
Open http://localhost:10000/
