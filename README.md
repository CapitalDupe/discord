# Discord clone (frontend)

A static, dependency-free Discord-style chat UI. Hosted on GitHub Pages.

**Works today in `local` mode:** servers, text channels, voice-channel placeholders, message grouping, markdown (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, code blocks, links), reactions, edit (↑ or ✏️), delete, member list, user name/color settings, mobile drawer layout. Data persists in your browser's localStorage. Right-click a server or channel to delete it.

## Plugging in your backend later

Edit `config.js`:

```js
window.CONFIG = { backend: 'remote', apiUrl: 'https://you.example/api', wsUrl: 'wss://you.example/ws', token: '...' };
```

The app expects:

- `GET {apiUrl}/state` → `{ user:{id,name,color}, members:[{id,name,color,bot?}], servers:[{id,name,channels:[{id,name,type:'text'|'voice'}]}], messages:{ [channelId]:[{id,uid,name,color,ts,text,edited?,r?:{[emoji]:[userId]}}] } }`
- A WebSocket at `wsUrl` (token sent as `?token=`). The client **sends** and **receives** the same JSON events:

| event | fields |
|---|---|
| `msg.new` | `cid`, `m` (message object) |
| `msg.edit` | `cid`, `id`, `text` |
| `msg.del` | `cid`, `id` |
| `msg.react` | `cid`, `id`, `emoji`, `uid` (toggles) |
| `srv.new` / `srv.del` | `s` / `sid` |
| `ch.new` / `ch.del` | `sid`, `c` / `sid`, `cid` |
| `user.set` | `u` |

Broadcast each event to all clients; duplicates are ignored by id. All state changes go through `reduce()` in `app.js`.

> GitHub Pages is public. Don't put secrets in `config.js`; use a login flow that issues short-lived tokens, and enable CORS for your Pages origin on the backend.
