"use node";
import { resultSchema } from "./scriptureStudy";
import { providerObjectSchema } from "./structuredOutput";

/** Shared provider adaptation, retained under the study API for existing callers. */
export const studyObjectProviderSchema = providerObjectSchema;

export function studyProviderSchema(modelId: string) {
  return providerObjectSchema(modelId, resultSchema);
}
