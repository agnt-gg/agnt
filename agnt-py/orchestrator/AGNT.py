#                                  __     
#                                 /  |    
#   ______    ______   _______   _$$ |_   
#  /      \  /      \ /       \ / $$   |  
#  $$$$$$  |/$$$$$$  |$$$$$$$  |$$$$$$/   
#  /    $$ |$$ |  $$ |$$ |  $$ |  $$ | __ 
# /$$$$$$$ |$$ \__$$ |$$ |  $$ |  $$ |/  |
# $$    $$ |$$    $$ |$$ |  $$ |  $$  $$/ 
#  $$$$$$$/  $$$$$$$ |$$/   $$/    $$$$/  
#           /  \__$$ |                    
#           $$    $$/                     
#            $$$$$$/   
# 
#
# AGENTIC GRAPH NETWORK TECHNOLOGY
# THE PRIMARY SYSTEM ORCHESTRATOR LAYER, MANAGES THE WORKFLOW EXECUTION

import os
import json
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import pydantic 
from pathlib import Path
import sys

# Fix the imports to use absolute paths
sys.path.append(str(Path(__file__).resolve().parent.parent))
from orchestrator.FIRE import FIRE 
from orchestrator.VIBE import VIBE
from utils.ascii_art import display_colored_art, AGNT_ACTIVATION, AGNT_COMPLETION, COLORS

# Define workflow schema using Pydantic instead of Zod
class Node(pydantic.BaseModel):
    id: str
    type: str
    category: str
    parameters: Dict[str, Any]
    text: Optional[str] = None

class Edge(pydantic.BaseModel):
    id: str
    startNodeId: str
    endNodeId: str
    condition: Optional[str] = None
    if_: Optional[str] = pydantic.Field(None, alias="if")
    value: Optional[str] = None
    maxIterations: Optional[str] = None

class Workflow(pydantic.BaseModel):
    id: str
    name: str
    nodes: List[Node]
    edges: List[Edge]

class AGNT:
    def __init__(self, workflow):
        self.workflow = workflow
        self.fire = FIRE(self)
        self.vibe = VIBE(self)
        self.outputs = {}
        self.execution_path = []
        self.edges_taken = []
        self.edge_iterations = {}  # Track iterations for each edge
        self.start_time = time.time()

    def validate_workflow(self):
        try:
            Workflow.model_validate(self.workflow)
        except Exception as error:
            raise ValueError(f"Workflow validation failed: {str(error)}")

    async def execute(self, trigger_data):
        display_colored_art(AGNT_ACTIVATION, COLORS["FG_GREEN"])

        self.validate_workflow()
        trigger_nodes = [n for n in self.workflow["nodes"] if n["category"] == "trigger"]
        
        if not trigger_nodes:
            # If no trigger nodes, start from the first node
            first_node = self.workflow["nodes"][0]
            if first_node:
                output = await self.fire.execute_node(first_node, trigger_data)
                self.outputs[first_node["id"]] = output
                self.execution_path.append({
                    "nodeId": first_node["id"],
                    "type": first_node["type"],
                    "text": first_node.get("text", first_node["type"]),
                    "timestamp": time.time() * 1000
                })
                await self.execute_next_nodes(first_node["id"], output)
        else:
            for node in trigger_nodes:
                output = await self.fire.execute_node(node, trigger_data)
                self.outputs[node["id"]] = output
                self.execution_path.append({
                    "nodeId": node["id"],
                    "type": node["type"],
                    "text": node.get("text", node["type"]),
                    "timestamp": time.time() * 1000
                })
                await self.execute_next_nodes(node["id"], output)
        
        # Save the execution summary after the workflow completes
        self.save_execution_summary()

        display_colored_art(AGNT_COMPLETION, COLORS["FG_GREEN"])
        
        return {
            "outputs": self.outputs,
            "executionPath": self.execution_path,
            "edgesTaken": self.edges_taken
        }

    async def execute_next_nodes(self, node_id, node_output):
        edges = [e for e in self.workflow["edges"] if e["startNodeId"] == node_id]
        for edge in edges:
            # Check if edge has reached its max iterations
            current_iterations = self.edge_iterations.get(edge["id"], 0)
            max_iterations = float("inf")
            
            if edge.get("maxIterations"):
                # Resolve the maxIterations template if it exists
                resolved_max_iterations = self.fire.plug.resolve_template(edge["maxIterations"])
                max_iterations = int(resolved_max_iterations) if resolved_max_iterations.isdigit() else float("inf")
            
            # Log edge evaluation
            if edge.get("condition"):
                print(f"-- Condition: {edge.get('if')} {edge.get('condition')} {edge.get('value')}\n")
            if max_iterations != float("inf"):
                print(f"-- Iterations: {current_iterations}/{max_iterations}\n")
            
            # Check if max iterations reached
            if current_iterations >= max_iterations:
                print(f"-- Result: FALSE - Max iterations ({max_iterations}) reached\n")
                continue
            
            # Evaluate the edge condition
            condition_met = self.vibe.evaluate(edge, node_output)
            print(f"-- Result: {'TRUE - Taking this path' if condition_met else 'FALSE - Skipping'}\n")
            
            if condition_met:
                # Increment the iteration count for this edge
                self.edge_iterations[edge["id"]] = current_iterations + 1
                
                # Track which edge was taken
                self.edges_taken.append({
                    "edgeId": edge["id"],
                    "from": edge["startNodeId"],
                    "to": edge["endNodeId"],
                    "condition": f"{edge.get('if')} {edge.get('condition')} {edge.get('value')}" if edge.get("condition") else "none",
                    "iteration": current_iterations + 1,
                    "timestamp": time.time() * 1000
                })
                
                next_node = next((n for n in self.workflow["nodes"] if n["id"] == edge["endNodeId"]), None)
                print(f"Next node decision: {next_node['id']} ({next_node.get('text', next_node['type'])})")
                
                output = await self.fire.execute_node(next_node, node_output)
                self.outputs[next_node["id"]] = output
                
                # Track execution path
                self.execution_path.append({
                    "nodeId": next_node["id"],
                    "type": next_node["type"],
                    "text": next_node.get("text", next_node["type"]),
                    "timestamp": time.time() * 1000
                })
                
                await self.execute_next_nodes(next_node["id"], output)

    def get_execution_summary(self):
        # Make sure execution_path is always a list
        execution_path = self.execution_path or []
        
        # Create a dict to track unique node executions (prevent duplicates)
        unique_nodes = {}
        unique_execution_path = []
        
        # Filter out duplicate node executions
        for node in execution_path:
            key = f"{node['nodeId']}-{node['timestamp']}"
            if key not in unique_nodes:
                unique_nodes[key] = True
                unique_execution_path.append(node)
        
        return {
            "workflowId": self.workflow["id"],
            "workflowName": self.workflow["name"],
            "executionPath": unique_execution_path,
            "edgesTaken": self.edges_taken or [],
            "outputs": self.outputs or {},
            "edgeIterations": self.edge_iterations or {},
            "startTime": self.start_time * 1000,  # Convert to milliseconds for consistency
            "endTime": time.time() * 1000,
            "duration": (time.time() - self.start_time) * 1000
        }
    
    def save_execution_summary(self):
        try:
            # Get the execution summary
            summary = self.get_execution_summary()
            
            # Create summaries directory if it doesn't exist
            summaries_dir = Path(__file__).parent.parent / "summaries"
            summaries_dir.mkdir(exist_ok=True, parents=True)
            
            # Create a unique filename with timestamp and workflow ID
            timestamp = datetime.now().isoformat().replace(":", "-")
            filename = f"{self.workflow['id']}_{timestamp}.json"
            file_path = summaries_dir / filename
            
            # Write the summary to file
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(summary, f, indent=2)
            
            print(f"Execution summary saved to: {file_path}\n")
            return str(file_path)
        except Exception as error:
            print(f"Error saving execution summary: {error}")
            return None