/**
 * Resolve a boolean trading flag from plugin config.
 *
 * - If the key is present on the config object (including schema default false), that wins.
 * - Env is bootstrap only when the key has never been set (first-run installs).
 * - Missing / invalid values fail closed to false once the key exists.
 */
export function resolveAllowTrading(
  config: Record<string, unknown>,
  key: string,
  envValue: string | undefined,
): boolean {
  if (Object.prototype.hasOwnProperty.call(config, key)) {
    const value = config[key];
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return false;
  }
  return envValue === "true" || envValue === "1";
}

export function parseYesNoSide(value: unknown): "yes" | "no" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "yes" || normalized === "no") {
    return normalized;
  }
  throw new Error(`side must be "yes" or "no" (got ${JSON.stringify(value)})`);
}

export function parseBuySellAction(value: unknown): "buy" | "sell" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "buy" || normalized === "sell") {
    return normalized;
  }
  throw new Error(
    `action must be "buy" or "sell" (got ${JSON.stringify(value)})`,
  );
}
