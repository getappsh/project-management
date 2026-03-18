import { Injectable } from '@nestjs/common';

@Injectable()
export class RuleEvaluationService {
  private readonly ruleEnginePromise: Promise<any>;

  constructor() {
    // Same ESM-safe dynamic import used in RuleValidationService
    this.ruleEnginePromise = (0, eval)("import('@usex/rule-engine/dist/esm/index.js')").then(
      (module) => module.RuleEngine,
    );
  }

  /**
   * Evaluates a rule against a context object.
   * Returns true if the context satisfies the rule, false otherwise.
   */
  async evaluateRule(rule: any, context: Record<string, any>): Promise<boolean> {
    const RuleEngine = await this.ruleEnginePromise;
    const ruleEngine = RuleEngine.getInstance();

    // The rule-engine resolves fields by flat key lookup after stripping the
    // leading `$` (e.g. `$.device.os` → key `"device.os"`).  We must flatten
    // the nested context to dot-notation keys before evaluation.
    const flatContext = this.addFieldAliases(this.flattenContext(context));

    const result = await ruleEngine.evaluate(rule, flatContext);

    // Handle both boolean and object return shapes
    if (typeof result === 'boolean') {
      return result;
    }
    return result?.isPassed ?? result?.result ?? result?.passed ?? false;
  }

  /**
   * Maps known flat-context keys to the canonical available-field names used
   * by rule definitions.  A new key is only added when the source key exists
   * in the context but the target key does not yet.
   */
  private readonly FIELD_ALIASES: Record<string, string> = {
    'device.os': 'device.os.name',
    'device.deviceName': 'device.name',
    'device.mac': 'device.macAddress',
    'device.availableStorage': 'device.storage.available',
    'device.power': 'device.battery.level',
  };

  private addFieldAliases(context: Record<string, any>): Record<string, any> {
    for (const [sourceKey, targetKey] of Object.entries(this.FIELD_ALIASES)) {
      if (sourceKey in context && !(targetKey in context)) {
        context[targetKey] = context[sourceKey];
      }
    }
    return context;
  }

  /**
   * Recursively flattens a nested object to dot-notation keys.
   * Arrays are kept as-is (not recursed into) so array operators still work.
   *
   * Example:
   *   { device: { os: 'macos', any: true } }
   *   → { 'device.os': 'macos', 'device.any': true }
   */
  private flattenContext(
    obj: Record<string, any>,
    prefix = '',
    result: Record<string, any> = {},
  ): Record<string, any> {
    for (const key of Object.keys(obj)) {
      const flatKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      if (
        value !== null &&
        value !== undefined &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        this.flattenContext(value, flatKey, result);
      } else {
        result[flatKey] = value;
      }
    }
    return result;
  }
}
