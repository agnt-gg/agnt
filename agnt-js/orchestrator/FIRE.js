//   ______   __                     
//  /      \ /  |                    
// /$$$$$$  |$$/   ______    ______  
// $$ |_ $$/ /  | /      \  /      \ 
// $$   |    $$ |/$$$$$$  |/$$$$$$  |
// $$$$/     $$ |$$ |  $$/ $$    $$ |
// $$ |      $$ |$$ |      $$$$$$$$/ 
// $$ |      $$ |$$ |      $$       |
// $$/       $$/ $$/        $$$$$$$/ 
// 
//
// FLUID INSTRUCTIONAL RUNTIME ENGINE
// THE PRIMARY SYSTEM ENGINE LAYER, MANAGES THE NODE EXECUTION

import PLUG from './PLUG.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { FIRE_EXECUTION, displayColoredArt, COLORS } from '../utils/ascii-art.js';

// Get the directory name properly in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class NodeExecutor {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.plug = new PLUG(orchestrator);
  }

  async executeNode(node, inputData) {
    try {
      displayColoredArt(FIRE_EXECUTION, COLORS.FG_RED);

      console.log(`Executing node: ${node.id} (${node.text || node.type})`);

      // Use proper path resolution to find the tools
      const toolPath = path.resolve(__dirname, '../tools', `${node.type}.js`);
      
      // Convert the path to a file:// URL for ESM imports
      const toolUrl = pathToFileURL(toolPath).href;
      
      const tool = await import(toolUrl);
      
      const resolvedParams = this.plug.resolve(node.parameters);
      
      // Create a clean copy of the context without circular references
      const cleanContext = {};
      Object.keys(this.orchestrator.outputs).forEach(nodeId => {
        // Deep clone each node output to break circular references
        cleanContext[nodeId] = JSON.parse(JSON.stringify(
          this.orchestrator.outputs[nodeId], 
          (key, value) => key === 'context' ? undefined : value
        ));
      });
      
      // Merge inputData with clean context
      const enhancedInputData = {
        ...inputData,
        context: cleanContext
      };
      
      const result = await tool.execute(resolvedParams, enhancedInputData);

      return result;
    } catch (error) {
      console.error(`Error executing node ${node.id}:`, error);
      return { error: error.message };
    }
  }
}