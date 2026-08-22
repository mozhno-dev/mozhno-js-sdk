# Mozhno JavaScript/TypeScript SDK

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![npm](https://img.shields.io/npm/v/@mozhno/client-js)](https://www.npmjs.com/package/@mozhno/client-js)

Feature flag evaluation for browser and Node.js — **local, no-network-per-check, fail-closed**.

## Installation

```bash
npm install @mozhno/client-js
```

## Quick Start

```typescript
import { MozhnoClient } from '@mozhno/client-js';

const client = new MozhnoClient({
  url: 'https://flags.example.com',
  apiKey: 'env-abc123',
  appName: 'my-app',
});

await client.start();

const on = client.isEnabled('new-checkout', { userId: '42' });
```

## Features

- **Evaluate locally** — flags are fetched once and evaluated in-memory. No network call per `isEnabled()`.
- **Fail-closed** — missing flags or fetch failures return `false`, never throw.
- **Server + client modes** — full rule set for server-side; pre-evaluated toggles for browser.
- **Sticky anonymous ID** — consistent evaluation for anonymous users via `localStorage`.
- **Metrics batching** — usage data buffered and sent at intervals; no data loss on send failure.

## API

```typescript
await client.start();                          // bootstrap + start timers
client.stop();                                 // clear timers

client.isEnabled('flag-key');                  // false if not found
client.isEnabled('flag-key', { userId: '42' }); // with context

client.updateContext({ userId: '99' });
client.setContextField('country', 'US');
client.removeContextField('country');
```

## Configuration

| Field | Default | Description |
|---|---|---|
| `url` | — (required) | URL of your Mozhno server |
| `apiKey` | — (required) | Server/Client API key |
| `appName` | — (required) | Application name |
| `refreshInterval` | 15s | Poll interval for flag updates |
| `metricsInterval` | 60s | Flush interval for usage metrics |
| `disableMetrics` | false | Disable usage metrics |
| `mode` | `server` | `server` (full rules) or `client` (pre-evaluated) |
| `stickyAnonId` | true | Persist anonymous user ID in localStorage |

## Events

```typescript
client.on('initialized', () => console.log('ready'));
client.on('update', (flags) => console.log('flags updated', flags));
client.on('error', (err) => console.error(err));
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
