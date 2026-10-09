// Time-driven jobs (implemented in build step 8).
import type { Services } from './services';

export function runDailyJob(_svc: Services): Record<string, number> {
  return {};
}

export function runHourlyJob(_svc: Services): Record<string, number> {
  return {};
}
