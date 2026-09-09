import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const supportRoot = dirname(fileURLToPath(import.meta.url));
const testRoot = resolve(supportRoot, '..');
const repositoryRoot = resolve(testRoot, '..');

const MIME_TYPES = new Map([
  ['.css', 'text/css'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.ico', 'image/vnd.microsoft.icon'],
  ['.js', 'application/javascript'],
  ['.json', 'application/json'],
  ['.meld', 'text/html'],
  ['.noengine', 'text/plain'],
  ['.template', 'text/html'],
  ['.txt', 'text/plain']
]);

function contentType(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (!extension) {
    return 'text/plain';
  }

  return MIME_TYPES.get(extension) || 'application/octet-stream';
}

function safePath(root, requestPath) {
  const candidate = resolve(root, requestPath);
  const offset = relative(root, candidate);

  if (offset.startsWith('..') || isAbsolute(offset)) {
    return null;
  }

  return candidate;
}

function resolveRequestPath(pathname) {
  if (pathname === '/') {
    return resolve(testRoot, 'index.html');
  }

  const repositoryMatch = pathname.match(/^\/(lib|vendor)\/(.+)$/);
  if (repositoryMatch) {
    return safePath(repositoryRoot, `${repositoryMatch[1]}/${repositoryMatch[2]}`);
  }

  return safePath(testRoot, pathname.replace(/^\/+/, ''));
}

function writeResponse(response, status, headers, body = '') {
  response.writeHead(status, headers);
  response.end(body);
}

export async function startRootTestServer() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestRecord = {
      method: request.method,
      url: request.url,
      status: null,
      startedAt
    };
    requests.push(requestRecord);

    function finish(status, headers, body) {
      requestRecord.status = status;
      requestRecord.durationMs = Date.now() - startedAt;
      writeResponse(response, status, headers, body);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      finish(404, { 'Content-Type': 'text/plain' }, 'Not Found');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      finish(400, { 'Content-Type': 'text/plain' }, 'Bad Request');
      return;
    }

    const filePath = resolveRequestPath(pathname);
    if (!filePath) {
      finish(403, { 'Content-Type': 'text/plain' }, 'Forbidden');
      return;
    }

    try {
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) {
        finish(404, { 'Content-Type': 'text/plain' }, 'Not Found');
        return;
      }

      const headers = {
        'Cache-Control': 'no-store',
        'Content-Length': fileInfo.size,
        'Content-Type': contentType(filePath)
      };

      requestRecord.status = 200;
      requestRecord.durationMs = Date.now() - startedAt;
      response.writeHead(200, headers);

      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        finish(404, { 'Content-Type': 'text/plain' }, 'Not Found');
      } else {
        requestRecord.error = error.message;
        finish(500, { 'Content-Type': 'text/plain' }, 'Internal Server Error');
      }
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    async stop() {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  };
}
