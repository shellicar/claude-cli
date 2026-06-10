import { ControlChannel, type SdkMessage } from '@shellicar/claude-sdk';

/** Named subclass so the container can distinguish this from ConsumerChannel. */
export class SdkChannel extends ControlChannel<SdkMessage> {}
