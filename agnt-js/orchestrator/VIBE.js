//             __  __                 
//            /  |/  |                
//  __     __ $$/ $$ |____    ______  
// /  \   /  |/  |$$      \  /      \ 
// $$  \ /$$/ $$ |$$$$$$$  |/$$$$$$  |
//  $$  /$$/  $$ |$$ |  $$ |$$    $$ |
//   $$ $$/   $$ |$$ |__$$ |$$$$$$$$/ 
//    $$$/    $$ |$$    $$/ $$       |
//     $/     $$/ $$$$$$$/   $$$$$$$/                   
// 
//
// VISUAL INFERENCE BEHAVIOR EVALUATOR
// THE PRIMARY SYSTEM OBSERVER LAYER, MANAGES THE EDGE AND NODE OUTPUT EVALUATION AND CONDITION CHECKING

import PLUG from './PLUG.js';
import { VIBE_ACTIVATION, displayColoredArt, COLORS } from '../utils/ascii-art.js';

export default class VIBE {
  constructor(orchestrator) {
    this.plug = new PLUG(orchestrator);
  }

  evaluate(edge, nodeOutput) {
    // Display the ASCII art with color when evaluating an edge
    displayColoredArt(VIBE_ACTIVATION, COLORS.FG_MAGENTA);

    console.log('Node output:', nodeOutput, '\n');
    console.log('Evaluating edge:', edge, '\n');
    
    // CAN DO SECURITY HERE WITH **NOPE** OR CHECK IF THE NODE OUTPUT IS VALID

    // IF VALID, RETURN TRUE

    // IF NOT VALID, RETURN FALSE

    if (!edge.condition) return true;
    const actualValue = this.plug.resolveTemplate(edge.if);
    const expectedValue = edge.value;

    // Convert to numbers for numeric comparisons
    const numActual = Number(actualValue);
    const numExpected = Number(expectedValue);

    switch (edge.condition) {
      case 'equals': return actualValue == expectedValue;
      case 'not_equals': return actualValue != expectedValue;
      case 'contains': return String(actualValue).includes(expectedValue);
      case 'not_contains': return !String(actualValue).includes(expectedValue);
      case 'greater_than': return numActual > numExpected;
      case 'less_than': return numActual < numExpected;
      case 'greater_than_or_equal': return numActual >= numExpected;
      case 'less_than_or_equal': return numActual <= numExpected;
      case 'between': 
        const [min, max] = expectedValue.split(',').map(Number);
        return numActual >= min && numActual <= max;
      default: 
        console.warn(`Unknown condition: ${edge.condition}`);
        return false;
    }
  }
}