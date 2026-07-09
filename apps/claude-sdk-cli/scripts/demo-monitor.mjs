// Demonstration monitor: a live tail of a conversation's conv/approval wire events. Run against the
// compose broker (`docker compose up`) with the CLI's nats participant enabled, and every event a real
// session publishes prints here — a human's window onto the wire.
//
//   NATS_URL=nats://localhost:4222 node scripts/demo-monitor.mjs
//
// Subscribes to conv.v1.> and approval.v1.> (all conversations).
import { connect } from '@nats-io/transport-node';

const url = process.env.NATS_URL ?? 'nats://localhost:4222';

const nc = await connect({ servers: url });
process.stdout.write(`subscribed to conv.v1.> and approval.v1.> on ${url}\n`);

for (const subject of ['conv.v1.>', 'approval.v1.>']) {
  const sub = nc.subscribe(subject);
  (async () => {
    for await (const m of sub) {
      process.stdout.write(`${m.subject}  ${new TextDecoder().decode(m.data)}\n`);
    }
  })();
}
