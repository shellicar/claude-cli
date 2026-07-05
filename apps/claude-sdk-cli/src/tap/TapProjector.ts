import type { ConsumerMessage, SdkMessage } from '@shellicar/claude-sdk';
import type { TapEventBody } from './TapEvent.js';

/** Maps the SDK/consumer message streams to spec event bodies. Returns null for messages that project to
 * nothing (the majority: text/thinking deltas, block lifecycle, tool_result, …). */
export class TapProjector {
  // Scaffold stub: the Builder implements the projection (plan §2) — the tool-name correlation and each
  // source event → spec body. Returns null throughout so the conformance tests are red until built.
  public fromSdk(_msg: SdkMessage): TapEventBody | null {
    return null;
  }

  public fromConsumer(_msg: ConsumerMessage): TapEventBody | null {
    return null;
  }
}
