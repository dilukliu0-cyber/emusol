# Emusol Cloudflare Signaling

Cloudflare Durable Objects do not need to be created manually from the empty
`Durable Objects` dashboard page for this project. On the Workers Free plan,
the recommended path is a Wrangler migration with a SQLite-backed Durable
Object class.

## Deploy

From this folder:

```bat
cd C:\Users\fedor\Desktop\Emusol\services\cloudflare-signaling
cmd /c npx wrangler login
cmd /c npx wrangler deploy
```

Wrangler will:

1. upload `worker.js`
2. create the Durable Object namespace for `SignalingHub`
3. bind it as `SIGNALING_HUB`
4. publish the Worker

## Result

Worker health endpoint:

```text
https://emusol-signaling.<your-subdomain>.workers.dev/health
```

WebSocket endpoint for Emusol:

```text
wss://emusol-signaling.<your-subdomain>.workers.dev/ws
```
