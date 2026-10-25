// Switch to 'remote' once your backend exists. See README.md for the protocol.
window.CONFIG = {
  backend: 'local',          // 'local' = browser storage only, 'remote' = REST + WebSocket
  apiUrl: '',                // e.g. https://chat.example.com/api  (GET /state)
  wsUrl: '',                 // e.g. wss://chat.example.com/ws
  token: ''                  // optional auth token sent to the backend
};
