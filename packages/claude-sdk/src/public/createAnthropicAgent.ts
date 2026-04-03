import { AnthropicAgent } from '../private/AnthropicAgent';
import type { IAnthropicAgent } from './interfaces';
import type { AnthropicAgentOptions } from './types';

export const createAnthropicAgent = (options: AnthropicAgentOptions): IAnthropicAgent => {
  return new AnthropicAgent(options);
};
