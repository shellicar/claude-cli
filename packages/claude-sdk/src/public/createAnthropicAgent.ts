import { AnthropicAgent } from "../private/AnthropicAgent";
import { IAnthropicAgent } from "./interfaces";
import { AnthropicAgentOptions } from "./types";


export const createAnthropicAgent = (options: AnthropicAgentOptions): IAnthropicAgent => {
  return new AnthropicAgent(options);
};
