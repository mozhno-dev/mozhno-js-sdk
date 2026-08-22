// Live E2E setup: prepares a real mozhno server for browser tests.
// Creates admin session, project keys (SERVER + FRONTEND) and flags with
// known bucket vectors (see sdk-tests/specifications), then writes env.json.
//
// Env:
//   LIVE_URL            server base URL (default http://localhost:8080)
//   LIVE_ADMIN_EMAIL    bootstrap admin email (default admin@mozhno.dev)
//   LIVE_ADMIN_PASSWORD bootstrap admin password (default admin)
//   LIVE_ENV_FILE       output file (default test/e2e-live/env.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = (process.env.LIVE_URL || 'http://localhost:8080').replace(/\/$/, '');
const email = process.env.LIVE_ADMIN_EMAIL || 'admin@mozhno.dev';
const password = process.env.LIVE_ADMIN_PASSWORD || 'admin';
const outFile = process.env.LIVE_ENV_FILE || join(here, 'env.json');

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function createFlag(token, environmentId, name, key, percentage) {
  const flag = await api('/api/v1/flags', {
    method: 'POST',
    token,
    body: { name, key, enabled: true, flagType: 'RELEASE' },
  });
  await api(`/api/v1/flags/${flag.id}/strategies`, {
    method: 'PUT',
    token,
    body: { environmentId, enabled: true, percentage },
  });
  return flag;
}

async function main() {
  // wait for the server to come up
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/v1/auth/login', { method: 'POST' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  const token = login.token;
  if (!token) throw new Error(`Login failed for ${email}: ${JSON.stringify(login)}`);

  const projects = await api('/api/v1/projects', { token });
  const projectId = projects[0]?.id;
  if (!projectId) throw new Error('No project found for admin user');

  // idempotent: reset the project so every run starts from a clean state
  await api('/api/v1/projects/reset', { method: 'POST', token });

  const envs = await api('/api/v1/environments', { token });
  const environmentId = envs[0]?.id ?? (await api('/api/v1/environments', { method: 'POST', token, body: { name: 'Production' } })).id;

  const serverKey = (await api('/api/v1/api-keys', {
    method: 'POST', token,
    body: { name: 'e2e-server', environmentId, keyType: 'SERVER' },
  })).apiKey;
  const clientKey = (await api('/api/v1/api-keys', {
    method: 'POST', token,
    body: { name: 'e2e-frontend', environmentId, keyType: 'FRONTEND' },
  })).apiKey;

  // flags with known bucket vectors (seed = flagKey + identifier):
  //   tf-anon + anon-1  -> bucket 99
  //   tf-user + user-1  -> bucket 31
  const flags = {
    full: await createFlag(token, environmentId, 'E2E Full', 'full-flag', 100),
    off: await createFlag(token, environmentId, 'E2E Off', 'off-flag', 0),
    anon66: await createFlag(token, environmentId, 'E2E Anon 66', 'tf-anon', 66),
    user32: await createFlag(token, environmentId, 'E2E User 32', 'tf-user', 32),
  };

  const env = {
    serverUrl: base,
    clientKey,
    serverKey,
    flags: Object.fromEntries(Object.entries(flags).map(([k, f]) => [k, f.key])),
  };
  writeFileSync(outFile, JSON.stringify(env, null, 2));
  console.log(`Live E2E env ready: ${outFile} (${Object.keys(env.flags).length} flags)`);
}

main().catch((e) => {
  console.error('Live E2E setup failed:', e.message);
  process.exit(1);
});
