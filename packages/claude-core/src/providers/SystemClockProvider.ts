import { Clock } from '@js-joda/core';
import { IClockProvider } from './IClockProvider';

export class SystemClockProvider extends IClockProvider {
  public get clock(): Clock {
    return Clock.systemDefaultZone();
  }
}
