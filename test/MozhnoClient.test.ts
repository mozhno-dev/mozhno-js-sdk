import { describe, expect, it, vi } from 'vitest';
import { MozhnoClient } from '../src/MozhnoClient';
import type { FeatureFlag, MozhnoConfig } from '../src/types';

function flag(key: string, rollOut: number, enabled = true): FeatureFlag {
  return { name: key, key, enabled, activation: { rollOut, constraints: [], segments: [] } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ETag: '"v1"' },
  });
}

function makeClient(mode: 'server' | 'client', fetchImpl: typeof fetch): MozhnoClient {
  return new MozhnoClient({
    url: 'http://localhost:9999',
    apiKey: 'test-key',
    clientKey: 'test-key',
    appName: 'unit',
    mode,
    refreshInterval: 0,
    fetch: fetchImpl,
  } as MozhnoConfig);
}

describe('MozhnoClient lifecycle', () => {
  it('server mode: retries with backoff, then loads flags and fires ready/update', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(jsonResponse([flag('tf-user', 32)]));

    const client = makeClient('server', fetchMock as unknown as typeof fetch);
    const events: string[] = [];
    client.on('ready', () => events.push('ready'));
    client.on('update', () => events.push('update'));

    await client.start();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events).toContain('ready');
    expect(events).toContain('update');
    // deterministic bucket: tf-user + user-1 -> 31 < 32 => true
    expect(client.isEnabled('tf-user', { userId: 'user-1' })).toBe(true);
    client.stop();
  }, 15000);

  it('server mode: emits error and no ready when all retries fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));

    const client = makeClient('server', fetchMock as unknown as typeof fetch);
    const events: string[] = [];
    client.on('ready', () => events.push('ready'));
    client.on('error', () => events.push('error'));

    await client.start();

    expect(events).toContain('error');
    expect(events).not.toContain('ready');
    client.stop();
  }, 15000);

  it('client mode: setContextField triggers a re-evaluate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ toggles: [{ name: 'full-flag', enabled: true }] }),
    );

    const client = makeClient('client', fetchMock as unknown as typeof fetch);
    await client.start();

    const evaluateCalls = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/client/evaluate')).length;

    expect(evaluateCalls()).toBe(1);

    client.setContextField('plan', 'gold');
    await vi.waitFor(() => expect(evaluateCalls()).toBe(2));

    expect(client.isEnabled('full-flag')).toBe(true);
    client.stop();
  });
});
