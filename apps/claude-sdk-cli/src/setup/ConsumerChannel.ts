import { type ConsumerMessage, ControlChannel } from '@shellicar/claude-sdk';

/** Named subclass so the container can distinguish this from SdkChannel. */
export class ConsumerChannel extends ControlChannel<ConsumerMessage> {}
