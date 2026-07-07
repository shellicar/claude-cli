// Demonstration subscriber: prints a live conversation's tap events. Run against the
// compose broker (`docker compose up`) with the CLI's tap enabled, and every event a
// real session publishes prints here — the proof the tap carries what the spec says.
//
//   TAP_URL=nats://localhost:4222 node scripts/tap-subscribe.mjs
//
// Subscribes to tap.v1.> (all conversations); pass a conversation id to narrow.
import { connect } from '@nats-io/transport-node';

const url = process.env.TAP_URL ?? 'nats://localhost:4222';
const conv = process.argv[2];
const subject = conv ? `tap.v1.${conv}.events` : 'tap.v1.>';

const nc = await connect({ servers: url });
process.stdout.write(`subscribed to ${subject} on ${url}\n`);

const sub = nc.subscribe(subject);
for await (const m of sub) {
  const event = JSON.parse(new TextDecoder().decode(m.data));
  process.stdout.write(`${m.subject}  ${JSON.stringify(event)}\n`);
}
