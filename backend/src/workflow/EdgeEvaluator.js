import ParameterResolver from './ParameterResolver.js';

class EdgeEvaluator {
  constructor(workflowEngine) {
    this.workflowEngine = workflowEngine;
    this.parameterResolver = new ParameterResolver(workflowEngine);
  }
  evaluateEdgeCondition(edge, nodeData) {
    if (!edge.if || !edge.condition) {
      return true;
    }

    let actualValue = this.parameterResolver.resolveTemplate(edge.if);
    const expectedValue = this.parameterResolver.resolveTemplate(edge.value);

    console.log(`Evaluating condition: ${actualValue} ${edge.condition} ${expectedValue}`);

    if (actualValue === "null" || actualValue === "undefined") {
      actualValue = null;
    }

    switch (edge.condition) {
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
        console.warn(`Unknown condition: ${edge.condition}`);
        return false;
    }
  }
}

export default EdgeEvaluator;