"use client";
import { useProcessingService } from "@/lib/useProcessingService";
import { ProcessingAvailabilityNotice } from "./ProcessingAvailabilityNotice";

export function ClipAvailabilityNotice() {
  const services = useProcessingService();
  return <ProcessingAvailabilityNotice state={services[services.clip_lane]} context="fast" className="px-4 py-3 lg:col-span-3" />;
}
