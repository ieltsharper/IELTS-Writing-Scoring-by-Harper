// Registers every action module with the router and exposes the API entry.
import { accountActions } from './handlers/account';
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
}

export function callApi(svc: Services, rawBody: string): ApiResponse {
  ensureRegistered();
  return handleRequest(svc, rawBody);
}
