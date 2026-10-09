// Registers every action module with the router and exposes the API entry.
import { accountActions } from './handlers/account';
import { adminActions } from './handlers/admin';
import { claudeSetupActions } from './handlers/claudeSetup';
import { listActions } from './handlers/lists';
import { scoringActions } from './handlers/scoring';
import { assignmentActions } from './handlers/assignments';
import { essayActions } from './handlers/essays';
import { type ApiResponse, handleRequest, registerActions } from './router';
import type { Services } from './services';

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerActions(accountActions);
  registerActions(essayActions);
  registerActions(assignmentActions);
  registerActions(adminActions);
  registerActions(listActions);
  registerActions(claudeSetupActions);
  registerActions(scoringActions);
}

export function callApi(svc: Services, rawBody: string): ApiResponse {
  ensureRegistered();
  return handleRequest(svc, rawBody);
}
