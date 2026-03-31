import { buildApp } from './app.ts';

const API_HOST = process.env.API_HOST ?? '0.0.0.0';
const API_PORT = Number(process.env.API_PORT) || 3000;

try {
  const app = buildApp();
  await app.listen({ port: API_PORT, host: API_HOST });
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
