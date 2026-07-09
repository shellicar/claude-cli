// Demonstration send: speak into a running CLI over the wire, and read its reply. Two modes:
//
//   node scripts/demo-send.mjs say <conversationId> "<message>" [tip]
//   node scripts/demo-send.mjs answer <approvalId> <yes|no>
//
// `say` publishes a spec-compliant say to conv.v1.<id>.requests and prints the reply (accepted + id,
// or a rejection). An optional [tip] sets the precondition so a stale premise is rejected honestly.
// `answer` replies to a raised approval on approval.v1.<id>.requests. The same tool fires a fixture's
// text in CI and a real prompt by hand.
import { connect } from '@nats-io/transport-node';

const url = process.env.NATS_URL ?? 'nats://localhost:4222';
const [mode, id, arg, tip] = process.argv.slice(2);

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const dec = (u) => JSON.parse(new TextDecoder().decode(u));

const nc = await connect({ servers: url });

if (mode === 'say') {
  const msg = { type: 'say', ts: new Date().toISOString(), from: { kind: 'human' }, text: arg, ...(tip ? { precondition: { tip } } : {}) };
  const reply = await nc.request(`conv.v1.${id}.requests`, enc(msg), { timeout: 5000 });
  process.stdout.write(`${JSON.stringify(dec(reply.data))}\n`);
} else if (mode === 'answer') {
  const msg = { type: 'answer', ts: new Date().toISOString(), from: { kind: 'human' }, approved: arg === 'yes' };
  const reply = await nc.request(`approval.v1.${id}.requests`, enc(msg), { timeout: 5000 });
  process.stdout.write(`${JSON.stringify(dec(reply.data))}\n`);
} else {
  process.stderr.write('usage: demo-send.mjs say <conversationId> "<message>" [tip] | answer <approvalId> <yes|no>\n');
  await nc.drain();
  process.exit(1);
}

await nc.drain();
