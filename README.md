# Discord clone (frontend)

A static, dependency-free Discord-style chat UI. No build step.

## Modes

| Mode | When | Notes |
|---|---|---|
| **v3 backend** (work in progress) | `?proto=v3`, page served from the same domain as the API | REST under `/api/v1`, realtime over Socket.IO. Access token kept in memory; the session survives reloads through an HttpOnly refresh cookie. |
| **v2 backend** (default) | any `?backend=https://api.example` | The working `/api` + `/ws` server, token in `localStorage`. Has direct messages, friends, replies, @mentions, typing, online status, avatars and file uploads. Switch back from v3 with `?proto=v2`. |
| **Local** | no backend known (for example on GitHub Pages) or `?backend=local` | Everything stays in this browser. A built-in bot answers `!ping` and `/help`. |

`?backend=https://api.example` sets the API address when the page is hosted elsewhere. Only the v3 same-domain setup keeps the refresh cookie first-party, so serve the page from the API's domain.

## Hosting with the v3 backend

Serve these static files and the API from one domain, for example with Caddy:

```
chat.example.com {
  handle /api/*       { reverse_proxy backend:3000 }
  handle /socket.io/* { reverse_proxy backend:3000 }
  handle              { root * /srv/frontend
                        file_server }
}
```

Backend settings to match: `WEB_URL` and `ALLOWED_ORIGINS` = `https://chat.example.com`, `TRUST_PROXY_HOPS=1`.
The Socket.IO client script is loaded from the API itself (`/socket.io/socket.io.js`), so no CDN is involved.

## What works in v3 mode

Login, registration (email and date of birth), email confirmation links, password reset links, two-factor codes and backup codes, the proof-of-work bot check, servers and text channels (create, delete or leave), message history (latest 50 per channel), live messages, edit, delete, reactions, typing indicators, presence dots, invite links, profile name and colour.

## Not built yet

Direct messages, voice and video (voice channels show a placeholder), file uploads, threads and forums, search, unread badges, scrolling back past the latest 50 messages, two-factor setup, session list, moderation and admin screens. The v3 backend routes this talks to are described in the backend's `docs/API.md`; they are not all implemented there yet, so login will not work until its auth module exists.

## Security notes

- Server data is never written to `localStorage` (local mode still is, since it has no server).
- Message text and names are HTML-escaped before rendering; error text from the server is shown with `textContent`.
- Reaction keys from the server are validated before use as object keys.

## Checks

```bash
npm run check   # syntax-checks every script
npm test        # tests for the v3 adapter (node:test, no dependencies)
```
