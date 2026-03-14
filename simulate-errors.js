#!/usr/bin/env node
// Simulate multiple error requests to both services to demonstrate cross-instance rate-limiting
const count = Number(process.argv[2] || 20);
const concurrency = Number(process.argv[3] || 5);
const expressUrl = process.env.EXPRESS_URL || 'http://localhost:3030/api/error';
const nestAppUrl = process.env.NEST_APP_URL || 'http://localhost:3031/error';
const nestAPIUrl = process.env.NEST_API_URL || 'http://localhost:3032/error';
const fastifyUrl = process.env.FASTIFY_URL || 'http://localhost:3033/error';

async function send(url) {
  try {
    console.log('---------------------', url, '->');
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    console.log(url, '->', res.status);
    return res.status;
  } catch (e) {
    console.error('request failed', e.message || e);
    return null;
  }
}

async function worker(id, tasks) {
  for (const t of tasks) {
    // rotate among available endpoints (express, nestApp, nestAPI, fastify)
    const urls = [expressUrl, nestAppUrl, nestAPIUrl, fastifyUrl];
    const url = urls[t % urls.length];
    await send(url);
  }
}

async function main() {
  const tasks = Array.from({ length: count }, (_, i) => i);
  const chunkSize = Math.ceil(count / concurrency);
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    const chunk = tasks.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length) workers.push(worker(i, chunk));
  }
  await Promise.all(workers);
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
