// Internal product defaults shared by the main Agent, Workers and presentation.
// Store only the environment variable name for a key, never a credential value.
// Explicit local configuration and HOMER_* overrides are resolved in config.ts.
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ModelRole = "main" | "worker";
export const PRODUCT_MODEL_DEFAULTS: Readonly<{
  model: string;
  effort: ReasoningEffort;
  workerEffort: ReasoningEffort;
  fast: boolean;
  workerFast: boolean;
  baseUrl?: string;
  keyEnv?: string;
  requiresOpenaiAuth: boolean;
}> = Object.freeze({
  model: "gpt-6.1-sol",
  effort: "medium",
  workerEffort: "high",
  fast: true,
  workerFast: true,
  baseUrl: undefined,
  keyEnv: undefined,
  requiresOpenaiAuth: true,
});

// Shared by execution and caller-facing configuration projections.
export function effectiveEffort(effort: ReasoningEffort | undefined, role: ModelRole = "main"): ReasoningEffort {
  return effort ?? (role === "worker" ? PRODUCT_MODEL_DEFAULTS.workerEffort : PRODUCT_MODEL_DEFAULTS.effort);
}

export function effectiveFast(fast: boolean | undefined, role: ModelRole = "main"): boolean {
  return fast ?? (role === "worker" ? PRODUCT_MODEL_DEFAULTS.workerFast : PRODUCT_MODEL_DEFAULTS.fast);
}
