// Prints anon and service_role JWTs for a JWT secret, like `supabase status` does.
import { createHmac } from 'node:crypto';

const secret = process.argv[2];
if (!secret) throw new Error('usage: node keys.mjs <jwt-secret>');
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (payload) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
console.log(`ANON_KEY=${sign({ iss: 'supabase-local', role: 'anon', exp })}`);
console.log(`SERVICE_ROLE_KEY=${sign({ iss: 'supabase-local', role: 'service_role', exp })}`);
