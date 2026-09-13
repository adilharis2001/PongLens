import { serviceLane, type ProcessingServiceStatus } from "./processingAvailability.ts";

export function waitingProcessingServiceState(kind: string, services: ProcessingServiceStatus) {
  return services[serviceLane(kind, services.clip_lane)];
}
