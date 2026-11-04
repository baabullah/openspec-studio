import { describe, expect, it } from 'vitest';
import { allowedHostnames, hostAllowed, requestAllowed } from '../src/security.ts';

describe('host / origin checks', () => {
  const allowed = allowedHostnames({});

  it('accepts loopback hosts on any port', () => {
    for (const h of ['127.0.0.1:3940', 'localhost:5173', 'LOCALHOST:1', '[::1]:3940', '127.0.0.1']) expect(hostAllowed(h, allowed)).toBe(true);
  });

  it('rejects other hosts (DNS rebinding)', () => {
    for (const h of ['evil.example:3940', '127.0.0.1.evil.example', '10.0.0.5:3940', '', undefined]) expect(hostAllowed(h, allowed)).toBe(false);
  });

  it('rebinding passes the old Origin==Host check but not this one', () => {
    expect(requestAllowed('evil.example:3940', 'http://evil.example:3940', allowed)).toBe(false);
  });

  it('requires the Origin to match the Host', () => {
    expect(requestAllowed('127.0.0.1:3940', 'http://127.0.0.1:3940', allowed)).toBe(true);
    expect(requestAllowed('127.0.0.1:5173', 'http://127.0.0.1:5173', allowed)).toBe(true); // vite dev proxy keeps Host
    expect(requestAllowed('127.0.0.1:3940', 'http://evil.example', allowed)).toBe(false);
    expect(requestAllowed('127.0.0.1:3940', 'null', allowed)).toBe(false);
    expect(requestAllowed('127.0.0.1:3940', undefined, allowed)).toBe(true); // curl / scripts
  });

  it('ALLOWED_HOSTS and a non-wildcard HOST extend the list', () => {
    const a = allowedHostnames({ ALLOWED_HOSTS: 'studio.lan, Dev.Box', HOST: '192.168.1.20' });
    for (const h of ['studio.lan:3940', 'dev.box', '192.168.1.20:3940', 'localhost']) expect(hostAllowed(h, a)).toBe(true);
    expect(hostAllowed('0.0.0.0:3940', allowedHostnames({ HOST: '0.0.0.0' }))).toBe(false);
  });
});
