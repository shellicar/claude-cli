import { createHash } from 'node:crypto';

export interface AttachedImage {
  readonly hash: string;
  readonly base64: string;
  readonly sizeBytes: number;
}

export interface ImageStoreState {
  readonly images: readonly AttachedImage[];
  readonly selectedIndex: number;
}

export function createImageStore(): ImageStoreState {
  return { images: [], selectedIndex: -1 };
}

export function addImage(state: ImageStoreState, data: Buffer): { state: ImageStoreState; isDuplicate: boolean } {
  const hash = createHash('sha256').update(data).digest('hex');
  if (state.images.some((img) => img.hash === hash)) {
    return { state, isDuplicate: true };
  }
  const base64 = data.toString('base64');
  const image: AttachedImage = { hash, base64, sizeBytes: data.length };
  const images = [...state.images, image];
  return {
    state: { images, selectedIndex: images.length - 1 },
    isDuplicate: false,
  };
}

export function removeSelected(state: ImageStoreState): ImageStoreState {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.images.length) {
    return state;
  }
  const images = state.images.filter((_, i) => i !== state.selectedIndex);
  const selectedIndex = images.length === 0 ? -1 : Math.min(state.selectedIndex, images.length - 1);
  return { images, selectedIndex };
}

export function selectLeft(state: ImageStoreState): ImageStoreState {
  if (state.images.length === 0) {
    return state;
  }
  return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
}

export function selectRight(state: ImageStoreState): ImageStoreState {
  if (state.images.length === 0) {
    return state;
  }
  return { ...state, selectedIndex: Math.min(state.images.length - 1, state.selectedIndex + 1) };
}

export function clearImages(): ImageStoreState {
  return createImageStore();
}

export function hasImages(state: ImageStoreState): boolean {
  return state.images.length > 0;
}
