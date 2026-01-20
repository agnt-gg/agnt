// OLD CODE BEFORE NESTED PARAMS
class ParameterResolver {
  constructor(workflowEngine) {
    this.workflowEngine = workflowEngine;
  }
  resolveParameters(params) {
    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        if (key === 'code') {
          // For JavaScript code, we need to escape backticks and handle multi-line strings
          resolved[key] = this.resolveJavaScriptCode(value);
        } else {
          // For other string parameters, use the existing template resolution
          resolved[key] = this.resolveTemplate(value);
        }
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
  resolveTemplate(template) {
    console.log('Resolving template:', template);
    console.log('Current trigger data:', JSON.stringify(this.workflowEngine.currentTriggerData));
    
    const templateString = String(template);
  
    // return templateString.replace(/{{(.*?)}}/g, (match, p1) => {
    //   const parts = p1.trim().split('.');
    //   const nodeName = parts.shift();
    //   let value;
  
    //   if (nodeName.toLowerCase() === 'trigger') {
    //     value = this.workflowEngine.currentTriggerData;
    //   } else {
    //     const nodeId = this.workflowEngine.nodeNameToId.get(nodeName.toLowerCase());
    //     value = this.workflowEngine.outputs[nodeId];
    //   }

    return templateString.replace(/{{(.*?)}}/g, (match, p1) => {
      const parts = p1.trim().split('.');
      const prefix = parts.shift();
      let value;
  
      if (prefix.toLowerCase() === 'trigger' || prefix.toLowerCase() === 'input') {
        value = this.workflowEngine.currentTriggerData[prefix.toLowerCase()];
      } else {
        const nodeId = this.workflowEngine.nodeNameToId.get(prefix.toLowerCase());
        value = this.workflowEngine.outputs[nodeId];
      }
  
      for (const part of parts) {
        if (value && typeof value === 'object') {
          // Handle array access
          if (part.includes('[') && part.includes(']')) {
            const [arrayName, indexStr] = part.split('[');
            const index = parseInt(indexStr.replace(']', ''), 10);
            value = value[arrayName] ? value[arrayName][index] : undefined;
          } else {
            value = value[part];
          }
        } else if (typeof value === 'string') {
          // Try to parse the string as JSON
          try {
            const parsedValue = JSON.parse(value);
            value = parsedValue[part];
          } catch (e) {
            console.warn(`Warning: Failed to parse JSON string: ${value}`);
            return undefined;
          }
        } else {
          console.warn(`Warning: Unable to resolve template ${match}`);
          return undefined;
        }
      }
  
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return JSON.stringify(value);
      }

      return value !== undefined ? value : undefined;
    });
  }

// NEW CODE WITH NESTED PARAMS
// class ParameterResolver {
//   constructor(workflowEngine) {
//     this.workflowEngine = workflowEngine;
//   }

//   resolveParameters(params) {
//     const resolved = {};
//     for (const [key, value] of Object.entries(params)) {
//       if (typeof value === "string") {
//         if (key === 'code') {
//           resolved[key] = this.resolveJavaScriptCode(value);
//         } else {
//           resolved[key] = this.resolveTemplate(value);
//         }
//       } else {
//         resolved[key] = value;
//       }
//     }
//     return resolved;
//   }

//   resolveTemplate(template) {
//     console.log('Resolving template:', template);
//     console.log('Current trigger data:', JSON.stringify(this.workflowEngine.currentTriggerData));
    
//     const templateString = String(template);
//     return this.resolveNestedTemplate(templateString);
//   }

  resolveNestedTemplate(template) {
    let result = template;
    let placeholders = this.findPlaceholders(template);

    // Sort placeholders by depth (innermost first)
    placeholders.sort((a, b) => b.depth - a.depth);

    // Resolve placeholders from innermost to outermost
    for (const {placeholder, start, end} of placeholders) {
      const resolved = this.resolvePlaceholder(placeholder);
      result = result.substring(0, start) + resolved + result.substring(end + 1);
    }

    return result;
  }

  findPlaceholders(template) {
    let placeholders = [];
    let stack = [];
    let depth = 0;

    for (let i = 0; i < template.length; i++) {
      if (template.substr(i, 2) === '{{') {
        stack.push(i);
        depth++;
        i++;
      } else if (template.substr(i, 2) === '}}' && stack.length > 0) {
        let start = stack.pop();
        placeholders.push({
          placeholder: template.substring(start + 2, i),
          start: start,
          end: i + 1,
          depth: depth
        });
        depth--;
        i++;
      }
    }

    return placeholders;
  }

  resolvePlaceholder(placeholder) {
    // First, resolve any nested placeholders
    placeholder = this.resolveNestedTemplate(placeholder);

    // Now split the resolved placeholder
    const parts = this.splitPlaceholder(placeholder);
    const nodeName = parts.shift();
    let value;

    if (nodeName.toLowerCase() === 'trigger') {
      value = this.workflowEngine.currentTriggerData;
    } else {
      const nodeId = this.workflowEngine.nodeNameToId.get(nodeName.toLowerCase());
      value = this.workflowEngine.outputs[nodeId];
    }

    for (let part of parts) {
      if (value && typeof value === 'object') {
        // Handle array access
        if (part.includes('[') && part.includes(']')) {
          const [arrayName, indexStr] = part.split('[');
          const index = parseInt(indexStr.replace(']', ''), 10);
          value = value[arrayName] ? value[arrayName][index] : undefined;
        } else {
          value = value[part];
        }
      } else if (typeof value === 'string') {
        // Try to parse the string as JSON
        try {
          const parsedValue = JSON.parse(value);
          value = parsedValue[part];
        } catch (e) {
          console.warn(`Warning: Failed to parse JSON string: ${value}`);
          return undefined;
        }
      } else {
        console.warn(`Warning: Unable to resolve part ${part} of placeholder ${placeholder}`);
        return undefined;
      }
    }

    // If the value is an array with a single string element, return just the string
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
      return value[0];
    }

    // For other types of values, return as is
    return value;
  }

  splitPlaceholder(placeholder) {
    const parts = [];
    let currentPart = '';
    let bracketCount = 0;

    for (let char of placeholder) {
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;

      if (char === '.' && bracketCount === 0) {
        parts.push(currentPart);
        currentPart = '';
      } else {
        currentPart += char;
      }
    }

    if (currentPart) parts.push(currentPart);

    return parts;
  }

  // TODO - NESTED PARAMS
  resolveJavaScriptCode(code) {
    return code.replace(/{{(.*?)}}/g, (match, p1) => {
      const parts = p1.trim().split('.');
      const nodeName = parts.shift();
      let value;

      if (nodeName.toLowerCase() === 'trigger') {
        value = this.workflowEngine.currentNodeData.trigger;
      } else {
        const nodeId = this.workflowEngine.nodeNameToId.get(nodeName.toLowerCase());
        value = this.workflowEngine.outputs[nodeId];
      }

      for (const part of parts) {
        if (value && typeof value === 'object') {
          // Handle array access
          if (part.includes('[') && part.includes(']')) {
            const [arrayName, indexStr] = part.split('[');
            const index = parseInt(indexStr.replace(']', ''), 10);
            value = value[arrayName][index];
          } else {
            value = value[part];
          }
        } else {
          console.warn(`Warning: Unable to resolve template ${match}`);
          return 'null';
        }
      }

      if (typeof value === 'string') {
        // If it's a string, return it wrapped in quotes
        return JSON.stringify(value);
      } else if (typeof value === 'object' && value !== null) {
        // If it's an object, stringify it
        return JSON.stringify(value);
      } else {
        // For other types (number, boolean, null, undefined)
        return value !== undefined ? String(value) : 'null';
      }
    });
  }
}

export default ParameterResolver;