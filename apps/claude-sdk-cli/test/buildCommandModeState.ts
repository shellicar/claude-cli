import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { CommandModeState, ICommandModeState } from '../src/model/CommandModeState.js';
import { IGraphemeSegmenter } from '../src/model/IGraphemeSegmenter.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';

/**
 * CommandModeState field-injects a segmenter for its two editors, so it cannot be
 * hand-constructed. One helper rather than a container in every spec.
 */
export function buildCommandModeState(): CommandModeState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services.register(IntlGraphemeSegmenter).asSelf().as(IGraphemeSegmenter);
  services.register(CommandModeState).asSelf().as(ICommandModeState);
  return services.buildProvider().resolve(CommandModeState);
}
