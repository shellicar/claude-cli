import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { EditorBuffer, IEditorBuffer } from '../src/model/EditorBuffer.js';
import { IGraphemeSegmenter } from '../src/model/IGraphemeSegmenter.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';

/**
 * EditorBuffer field-injects its segmenter, so it cannot be hand-constructed.
 * One helper rather than a container in every spec that needs a buffer.
 */
export function buildEditorBuffer(): EditorBuffer {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services.register(IntlGraphemeSegmenter).asSelf().as(IGraphemeSegmenter);
  services.register(EditorBuffer).asSelf().as(IEditorBuffer);
  return services.buildProvider().resolve(EditorBuffer);
}
