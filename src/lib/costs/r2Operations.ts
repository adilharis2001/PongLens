import type { UsageEvent } from "./meter.ts";
import type { CostUnit } from "./types.ts";

export type R2Operation =
  | "put_object"
  | "create_multipart_upload"
  | "upload_part"
  | "complete_multipart_upload"
  | "list_parts"
  | "list_objects"
  | "head_object"
  | "get_object"
  | "delete_object"
  | "abort_multipart_upload";

const CLASSES: Partial<Record<R2Operation, CostUnit>> = {
  put_object: "class_a_operation",
  create_multipart_upload: "class_a_operation",
  upload_part: "class_a_operation",
  complete_multipart_upload: "class_a_operation",
  list_parts: "class_b_operation",
  list_objects: "class_b_operation",
  head_object: "class_b_operation",
  get_object: "class_b_operation",
};

export function classifyR2Operation(
  operation: R2Operation,
): CostUnit | null {
  return CLASSES[operation] ?? null;
}

export function r2OperationEvent({
  operation,
  idempotencyKey,
  assumed = false,
}: {
  operation: R2Operation;
  idempotencyKey: string;
  assumed?: boolean;
}): UsageEvent | null {
  const unit = classifyR2Operation(operation);
  if (!unit) return null;
  return {
    provider: "Cloudflare",
    service: "R2",
    operation,
    sku: "r2-standard",
    quantity: 1,
    unit,
    source: assumed ? "assumed" : "internal",
    idempotencyKey: `r2:${idempotencyKey}:${operation}`,
    metadata: { storage_class: "standard" },
  };
}

