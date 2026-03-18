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

    const result = await ruleEngine.evaluate(rule, context);

    // Handle both boolean and object return shapes
    if (typeof result === 'boolean') {
      return result;
    }
    return result?.result ?? result?.passed ?? false;
  }
}
