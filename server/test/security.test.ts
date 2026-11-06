import { describe, expect, it } from 'vitest';
import { allowedHostnames, hostAllowed, mutationAllowed, requestAllowed } from '../src/security.ts';

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

describe('mutationAllowed (CSRF)', () => {
  const A = allowedHostnames({});
  const H = '127.0.0.1:3940', O = 'http://127.0.0.1:3940', JSON_CT = 'application/json';
  it('lets reads through', () => {
    expect(mutationAllowed('GET', H, 'https://evil.example', undefined, A)).toBe(true);
  });
  it('needs JSON for POST', () => {
    expect(mutationAllowed('POST', H, O, JSON_CT, A)).toBe(true);
    expect(mutationAllowed('POST', H, O, 'text/plain', A)).toBe(false);
    expect(mutationAllowed('POST', H, O, undefined, A)).toBe(false);
  });
  it('allows a body-less same-origin DELETE (delete comment)', () => {
    expect(mutationAllowed('DELETE', H, O, undefined, A)).toBe(true);
    expect(mutationAllowed('PATCH', H, O, JSON_CT, A)).toBe(true);
  });
  it('rejects cross-origin and foreign hosts for every mutating method', () => {
    for (const m of ['POST', 'DELETE', 'PATCH', 'PUT']) {
      expect(mutationAllowed(m, H, 'https://evil.example', JSON_CT, A)).toBe(false);
      expect(mutationAllowed(m, 'evil.example', 'http://evil.example', JSON_CT, A)).toBe(false);
    }
  });
});
