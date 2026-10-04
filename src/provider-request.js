export function resolveRequestProviderId(activeProviderId, pendingProviderId, currentProviderId) {
  return pendingProviderId || activeProviderId || currentProviderId;
}
