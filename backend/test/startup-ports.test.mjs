import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { freePort } from '../scripts/ports.mjs';

test('startup detects a frontend already bound to localhost', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const port = server.address().port;
  try {
    await assert.rejects(freePort(port, 'localhost'), /already in use/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  await freePort(port, 'localhost');
});

test('startup detects an API using the default listen address', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });
  try {
    await assert.rejects(freePort(server.address().port), /already in use/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
