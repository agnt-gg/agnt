//            __                     
//           /  |                    
//   ______  $$ | __    __   ______  
//  /      \ $$ |/  |  /  | /      \ 
// /$$$$$$  |$$ |$$ |  $$ |/$$$$$$  |
// $$ |  $$ |$$ |$$ |  $$ |$$ |  $$ |
// $$ |__$$ |$$ |$$ \__$$ |$$ \__$$ |
// $$    $$/ $$ |$$    $$/ $$    $$ |
// $$$$$$$/  $$/  $$$$$$/   $$$$$$$ |
// $$ |                    /  \__$$ |
// $$ |                    $$    $$/ 
// $$/                      $$$$$$/          
// 
//
// PARAMETER LOOKUP UTILITY GATEWAY
// THE PRIMARY SYSTEM INTERPOLATION LAYER, MANAGES THE NODE PARAMETER RESOLUTION FOR NODES AND EDGES

import { PLUG_EXECUTION, displayColoredArt, COLORS } from '../utils/ascii-art.js';

export default class PLUG {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
  }

  resolve(params) {
    displayColoredArt(PLUG_EXECUTION, COLORS.FG_YELLOW);

    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveTemplate(value);
    }
    return resolved;
  }

  resolveTemplate(template) {
    if (typeof template !== "string") return template;
    return template.replace(/{{(.*?)}}/g, (_, path) => {
      const parts = path.trim().split('.');
      const nodeId = parts.shift();
      let value = this.orchestrator.outputs[nodeId];
      
      // Navigate through nested properties
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = value[part];
        } else {
          return '';
        }
      }
      
      return value !== undefined ? value : '';
    });
  }
}
