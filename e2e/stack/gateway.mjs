// Minimal stand-in for Supabase's API gateway: routes /auth/v1 to GoTrue and
// /rest/v1 to PostgREST, adds CORS headers. Development and testing only.
import http from 'node:http';

const port = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  { prefix: '/auth/v1', target: Number(process.env.GOTRUE_PORT ?? 9999) },
  { prefix: '/rest/v1', target: Number(process.env.POSTGREST_PORT ?? 3000) },
];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    const route = routes.find(
      (r) => req.url === r.prefix || req.url?.startsWith(`${r.prefix}/`) || req.url?.startsWith(`${r.prefix}?`),
    );
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json', ...cors }).end('{"message":"no route"}');
      return;
    }
    const path = req.url.slice(route.prefix.length) || '/';
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: route.target,
        path,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${route.target}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ message: err.message }));
    });
    req.pipe(upstream);
  })
  .listen(port, '127.0.0.1', () => console.log(`gateway listening on http://127.0.0.1:${port}`));
