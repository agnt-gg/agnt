import ParameterResolver from './ParameterResolver.js';

class EdgeEvaluator {
  constructor(workflowEngine) {
    this.workflowEngine = workflowEngine;
    this.parameterResolver = new ParameterResolver(workflowEngine);
  }

  evaluateEdgeCondition(edge, nodeData) {
    // New: compound conditions
    if (edge.conditions && edge.conditions.length > 0) {
      return this.evaluateCompoundConditions(edge.conditions);
    }

    // Legacy: single condition (backward compat)
    return this.evaluateSingleCondition(edge);
  }

  evaluateCompoundConditions(conditions) {
    let result = this.evaluateSingleCondition(conditions[0]);

    for (let i = 1; i < conditions.length; i++) {
      const cond = conditions[i];
      const condResult = this.evaluateSingleCondition(cond);

      if (cond.logic === 'or') {
        result = result || condResult;
      } else {
        // 'and' is the default
        result = result && condResult;
      }
    }

    return result;
  }

  evaluateSingleCondition(cond) {
    if (!cond.if || !cond.condition) {
      return true;
    }

    let actualValue = this.parameterResolver.resolveTemplate(cond.if);
    const expectedValue = this.parameterResolver.resolveTemplate(cond.value || '');

    console.log(`Evaluating condition: ${actualValue} ${cond.condition} ${expectedValue}`);

    if (actualValue === "null" || actualValue === "undefined") {
      actualValue = null;
    }

    switch (cond.condition) {
      case "is_empty":
        return actualValue === "" || actualValue === null || actualValue === undefined;
      case "is_not_empty":
        return actualValue !== "" && actualValue !== null && actualValue !== undefined;
      case "equals":
        return actualValue == expectedValue;
      case "not_equals":
        return actualValue != expectedValue;
      case "greater_than":
        return parseFloat(actualValue) > parseFloat(expectedValue);
      case "less_than":
        return parseFloat(actualValue) < parseFloat(expectedValue);
      case "greater_than_or_equal":
        return parseFloat(actualValue) >= parseFloat(expectedValue);
      case "less_than_or_equal":
        return parseFloat(actualValue) <= parseFloat(expectedValue);
      case "contains":
        return String(actualValue).includes(String(expectedValue));
      case "not_contains":
        return !String(actualValue).includes(String(expectedValue));
      default:
        console.warn(`Unknown condition: ${cond.condition}`);
        return false;
    }
  }
}

export default EdgeEvaluator;
