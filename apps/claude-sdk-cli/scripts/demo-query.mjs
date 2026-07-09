// Demonstration query: how the agent verifies the arc without holding a live tail. Pulls a
// conversation's events back from the JetStream `conv-approval` stream and asserts the turn arc.
//
//   node scripts/demo-query.mjs <conversationId>
//
// Exits 0 (PASS) when turn_started, turn_ended, and at least one committed message on `changes` are
// present; 1 (FAIL) otherwise. The compose stream captures durably, so this reads after the fact.
import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';

const conv = process.argv[2];
if (!conv) {
  process.stderr.write('usage: demo-query.mjs <conversationId>\n');
  process.exit(1);
}

const url = process.env.NATS_URL ?? 'nats://localhost:4222';
const nc = await connect({ servers: url });
const consumer = await jetstream(nc).consumers.get('conv-approval', { filter_subjects: [`conv.v1.${conv}.>`] });

// fetch (not consume): a one-shot pull that completes when max_messages arrive OR expires elapses.
// consume is for continuous consumption — it blocks waiting for more once the stream goes idle, so a
// deadline checked inside the loop never fires after the last stored event. fetch bounds the pull.
const seen = [];
const iter = await consumer.fetch({ max_messages: 200, expires: 5000 });
for await (const m of iter) {
  seen.push({ subject: m.subject, ...JSON.parse(new TextDecoder().decode(m.data)) });
  m.ack();
}

const types = new Set(seen.map((e) => e.type));
const ok = types.has('turn_started') && types.has('turn_ended') && seen.some((e) => e.subject.endsWith('.changes'));
process.stdout.write(`${ok ? 'PASS' : 'FAIL'} — ${seen.length} events: ${[...types].join(',')}\n`);
await nc.drain();
process.exit(ok ? 0 : 1);
