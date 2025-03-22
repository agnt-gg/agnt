//                                  __     
//                                 /  |    
//   ______    ______   _______   _$$ |_   
//  /      \  /      \ /       \ / $$   |  
//  $$$$$$  |/$$$$$$  |$$$$$$$  |$$$$$$/   
//  /    $$ |$$ |  $$ |$$ |  $$ |  $$ | __ 
// /$$$$$$$ |$$ \__$$ |$$ |  $$ |  $$ |/  |
// $$    $$ |$$    $$ |$$ |  $$ |  $$  $$/ 
//  $$$$$$$/  $$$$$$$ |$$/   $$/    $$$$/  
//           /  \__$$ |                    
//           $$    $$/                     
//            $$$$$$/   
// 
//
// AGENTIC GRAPH NETWORK TECHNOLOGY
// THE PRIMARY SYSTEM ORCHESTRATOR LAYER, MANAGES THE WORKFLOW EXECUTION

import { z } from 'zod';
import FIRE from './FIRE.js';
import VIBE from './VIBE.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AGNT_ACTIVATION, AGNT_COMPLETION, displayColoredArt, COLORS } from '../utils/ascii-art.js';

// Get the directory name properly in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define workflow schema using Zod
const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      category: z.string(),
      parameters: z.record(z.any())
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      startNodeId: z.string(),
      endNodeId: z.string(),
      condition: z.string().optional(),
      if: z.string().optional(),
      value: z.string().optional(),
      maxIterations: z.string().optional()
    })
  )
});

export default class AGNT {
  constructor(workflow) {
    this.workflow = workflow;
    this.fire = new FIRE(this);
    this.vibe = new VIBE(this);
    this.outputs = {};
    this.executionPath = [];
    this.edgesTaken = [];
    this.edgeIterations = new Map(); // Track iterations for each edge
    this.startTime = Date.now();
  }

  validateWorkflow() {
    try {
      workflowSchema.parse(this.workflow);
    } catch (error) {
      throw new Error(`Workflow validation failed: ${error.message}`);
    }
  }

  async execute(triggerData) {
    displayColoredArt(AGNT_ACTIVATION, COLORS.FG_GREEN);

    this.validateWorkflow();
    const triggerNodes = this.workflow.nodes.filter(n => n.category === 'trigger');
    
    if (triggerNodes.length === 0) {
      // If no trigger nodes, start from the first node
      const firstNode = this.workflow.nodes[0];
      if (firstNode) {
        const output = await this.fire.executeNode(firstNode, triggerData);
        this.outputs[firstNode.id] = output;
        this.executionPath.push({
          nodeId: firstNode.id,
          type: firstNode.type,
          text: firstNode.text || firstNode.type,
          timestamp: Date.now()
        });
        await this.executeNextNodes(firstNode.id, output);
      }
    } else {
      for (const node of triggerNodes) {
        const output = await this.fire.executeNode(node, triggerData);
        this.outputs[node.id] = output;
        this.executionPath.push({
          nodeId: node.id,
          type: node.type,
          text: node.text || node.type,
          timestamp: Date.now()
        });
        await this.executeNextNodes(node.id, output);
      }
    }
    
    // Save the execution summary after the workflow completes
    this.saveExecutionSummary();

    displayColoredArt(AGNT_COMPLETION, COLORS.FG_GREEN);
    
    return {
      outputs: this.outputs,
      executionPath: this.executionPath,
      edgesTaken: this.edgesTaken
    };
  }

  async executeNextNodes(nodeId, nodeOutput) {
    const edges = this.workflow.edges.filter(e => e.startNodeId === nodeId);
    for (const edge of edges) {
      // Check if edge has reached its max iterations
      const currentIterations = this.edgeIterations.get(edge.id) || 0;
      let maxIterations = Infinity;
      
      if (edge.maxIterations) {
        // Resolve the maxIterations template if it exists
        const resolvedMaxIterations = this.fire.parameterResolver.resolveTemplate(edge.maxIterations);
        maxIterations = parseInt(resolvedMaxIterations) || Infinity;
      }
      
      // Log edge evaluation
      if (edge.condition) {
        console.log(`-- Condition: ${edge.if} ${edge.condition} ${edge.value}\n`);
      }
      if (maxIterations !== Infinity) {
        console.log(`-- Iterations: ${currentIterations}/${maxIterations}\n`);
      }
      
      // Check if max iterations reached
      if (currentIterations >= maxIterations) {
        console.log(`-- Result: FALSE - Max iterations (${maxIterations}) reached\n`);
        continue;
      }
      
      // Evaluate the edge condition
      const conditionMet = this.vibe.evaluate(edge, nodeOutput);
      console.log(`-- Result: ${conditionMet ? 'TRUE - Taking this path' : 'FALSE - Skipping'}\n`);
      
      if (conditionMet) {
        // Increment the iteration count for this edge
        this.edgeIterations.set(edge.id, currentIterations + 1);
        
        // Track which edge was taken
        this.edgesTaken.push({
          edgeId: edge.id,
          from: edge.startNodeId,
          to: edge.endNodeId,
          condition: edge.condition ? `${edge.if} ${edge.condition} ${edge.value}` : 'none',
          iteration: currentIterations + 1,
          timestamp: Date.now()
        });
        
        const nextNode = this.workflow.nodes.find(n => n.id === edge.endNodeId);
        console.log(`Next node decision: ${nextNode.id} (${nextNode.text || nextNode.type})`);
        
        const output = await this.fire.executeNode(nextNode, nodeOutput);
        this.outputs[nextNode.id] = output;
        
        // Track execution path
        this.executionPath.push({
          nodeId: nextNode.id,
          type: nextNode.type,
          text: nextNode.text || nextNode.type,
          timestamp: Date.now()
        });
        
        await this.executeNextNodes(nextNode.id, output);
      }
    }
  }
  
  getExecutionSummary() {
    // Make sure executionPath is always an array
    const executionPath = this.executionPath || [];
    
    // Create a map to track unique node executions (prevent duplicates)
    const uniqueNodes = new Map();
    const uniqueExecutionPath = [];
    
    // Filter out duplicate node executions
    executionPath.forEach(node => {
      const key = `${node.nodeId}-${node.timestamp}`;
      if (!uniqueNodes.has(key)) {
        uniqueNodes.set(key, true);
        uniqueExecutionPath.push(node);
      }
    });
    
    return {
      workflowId: this.workflow.id,
      workflowName: this.workflow.name,
      executionPath: uniqueExecutionPath,
      edgesTaken: this.edgesTaken || [],
      outputs: this.outputs || {},
      edgeIterations: Object.fromEntries(this.edgeIterations || new Map()),
      startTime: this.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.startTime
    };
  }
  
  saveExecutionSummary() {
    try {
      // Get the execution summary
      const summary = this.getExecutionSummary();
      
      // Create summaries directory if it doesn't exist
      const summariesDir = path.resolve(__dirname, '../summaries');
      if (!fs.existsSync(summariesDir)) {
        fs.mkdirSync(summariesDir, { recursive: true });
      }
      
      // Create a unique filename with timestamp and workflow ID
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `${this.workflow.id}_${timestamp}.json`;
      const filePath = path.join(summariesDir, filename);
      
      // Write the summary to file
      fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf8');
      
      console.log(`Execution summary saved to: ${filePath}\n`);
      return filePath;
    } catch (error) {
      console.error('Error saving execution summary:', error);
    }
  }
}