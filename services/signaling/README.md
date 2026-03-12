# Signaling Service

This service will manage:

- presence
- friends
- invites
- room state
- multiplayer session signaling

## Current MVP

The service now already handles:

- websocket sessions
- presence snapshots
- room create/join/leave
- ready-state
- invites
- room launch events
- relay messages for future and current netplay signals
- current netplay signal channels for input relay, ROM hash, state hash, and resync requests

## Run

```bat
cd C:\Users\fedor\Desktop\Emusol
cmd /c npm run start:signaling
```

Default websocket URL:

```text
ws://127.0.0.1:43123
```
