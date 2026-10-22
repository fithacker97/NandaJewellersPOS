import net from 'node:net';

export function freePort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => {
      reject(error.code === 'EADDRINUSE'
        ? new Error('Port ' + port + ' is already in use. Stop the previous frontend/backend terminal with Ctrl+C and retry.')
        : error);
    });
    server.listen({ port, host }, () => server.close(resolve));
  });
}
