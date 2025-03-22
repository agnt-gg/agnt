#   ______   __                     
#  /      \ /  |                    
# /$$$$$$  |$$/   ______    ______  
# $$ |_ $$/ /  | /      \  /      \ 
# $$   |    $$ |/$$$$$$  |/$$$$$$  |
# $$$$/     $$ |$$ |  $$/ $$    $$ |
# $$ |      $$ |$$ |      $$$$$$$$/ 
# $$ |      $$ |$$ |      $$       |
# $$/       $$/ $$/        $$$$$$$/ 
# 
#
# FLUID INSTRUCTIONAL RUNTIME ENGINE
# THE PRIMARY SYSTEM ENGINE LAYER, MANAGES THE NODE EXECUTION

import importlib.util
import json
import sys
from pathlib import Path

# Fix imports to use absolute paths
sys.path.append(str(Path(__file__).resolve().parent.parent))
from orchestrator.PLUG import PLUG
from utils.ascii_art import FIRE_EXECUTION, display_colored_art, COLORS

class FIRE:
    def __init__(self, orchestrator):
        self.orchestrator = orchestrator
        self.plug = PLUG(orchestrator)

    async def execute_node(self, node, input_data):
        try:
            display_colored_art(FIRE_EXECUTION, COLORS["FG_RED"])

            print(f"Executing node: {node['id']} ({node.get('text', node['type'])})")

            # Use proper path resolution to find the tools
            tool_path = Path(__file__).parent.parent / "tools" / f"{node['type']}.py"
            
            # Import the tool module dynamically
            spec = importlib.util.spec_from_file_location(
                f"tools.{node['type']}", 
                tool_path
            )
            tool = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = tool
            spec.loader.exec_module(tool)
            
            resolved_params = self.plug.resolve(node["parameters"])
            
            # Create a clean copy of the context without circular references
            clean_context = {}
            for node_id, output in self.orchestrator.outputs.items():
                # Deep clone each node output to break circular references
                clean_context[node_id] = json.loads(json.dumps(output))
            
            # Merge input_data with clean context
            enhanced_input_data = {
                **(input_data or {}),
                "context": clean_context
            }
            
            result = await tool.execute(resolved_params, enhanced_input_data)

            return result
        except Exception as error:
            print(f"Error executing node {node['id']}:", error)
            return {"error": str(error)}