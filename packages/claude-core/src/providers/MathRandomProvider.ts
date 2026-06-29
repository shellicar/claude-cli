import { IRandomProvider } from './IRandomProvider';

export class MathRandomProvider extends IRandomProvider {
  public next(): number {
    return Math.random();
  }
}
