import { Clock } from '@js-joda/core';
import { ApprovalCoordinator } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IBus } from '../bus/IBus.js';
import { IConvChangePublisher } from '../conv/ConvChangePublisher.js';
import { IConvTelemetryProjector } from '../conv/ConvTelemetryProjector.js';
import { telemetryLeaf } from '../conv/telemetryLeaf.js';
import { stamp } from '../conv/wire.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { ConsumerChannel } from './ConsumerChannel.js';
import { SdkChannel } from './SdkChannel.js';
import { ITurnCoordinator } from './TurnCoordinator.js';

/** The router's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConsumerMessageRouter {
  public abstract wire(): void;
}

/**
 * Routes every message off `ConsumerChannel` through `ApprovalCoordinator`, then reacts to the
 * outcome: a `query_cancel` publishes the cancelled telemetry leaf and aborts the in-flight turn;
 * a `tool_cancel` tells the SDK side a tool is cancelling.
 *
 * Was inline in `main.ts`'s `runApp`, resolving `ApprovalCoordinator` fresh from the container on
 * every message inside the subscribe callback. Extracted so the coordinator is a declared
 * dependency, not a repeated ad-hoc resolve, and so `buildContainer(...).validate()` sees this wiring.
 */
export class ConsumerMessageRouter extends IConsumerMessageRouter {
  @dependsOn(ApprovalCoordinator) private readonly approvalCoordinator!: ApprovalCoordinator;
  @dependsOn(ConsumerChannel) private readonly consumerChannel!: ConsumerChannel;
  @dependsOn(ITurnCoordinator) private readonly turnCoordinator!: ITurnCoordinator;
  @dependsOn(IConvTelemetryProjector) private readonly convTelemetry!: IConvTelemetryProjector;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IConvChangePublisher) private readonly convChanges!: IConvChangePublisher;
  @dependsOn(SdkChannel) private readonly sdkChannel!: SdkChannel;

  public wire(): void {
    this.consumerChannel.subscribe(async (msg) => {
      const outcome = this.approvalCoordinator.handle(msg);
      // A tool-cancel must NOT abort the query controller: the delivery turn
      // reuses it to send the cancellation tool_result to the model. Only a
      // query-cancel (model streaming, or a second ESC during a tool) aborts it.
      if (outcome === 'query_cancel' && this.turnCoordinator.hasActiveTurn()) {
        const cancelled = telemetryLeaf(this.convTelemetry.cancelled());
        this.bus.publish(`conv.v2.${this.session.id}.telemetry.${cancelled.leaf}`, stamp(this.clock, cancelled.rest));
        const cancelledQueryId = this.session.conversationTip()?.queryId;
        if (cancelledQueryId != null) {
          this.convChanges.closeQuery(this.session.id, cancelledQueryId, 'cancelled');
        }
        this.turnCoordinator.abort();
      } else if (outcome === 'tool_cancel') {
        this.sdkChannel.send({ type: 'tool_cancelling' });
      }
    });
  }
}
