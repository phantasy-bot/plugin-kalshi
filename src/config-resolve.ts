/**
 * Plugin UI config wins when the operator has set a value.
 * Env is only a bootstrap default for first-run installs.
 */
export function resolveAllowTrading(
  configValue: unknown,
  envValue: string | undefined,
): boolean {
  if (typeof configValue === "boolean") return configValue;
  if (configValue === "true" || configValue === "1") return true;
  if (configValue === "false" || configValue === "0") return false;
  return envValue === "true" || envValue === "1";
}
