import sys
from pathlib import Path

# Add the parent directory to sys.path to ensure Python can find your packages
sys.path.append(str(Path(__file__).resolve().parent.parent))

import asyncio
import json
from orchestrator import AGNT  # Now this import will work correctly

async def main():
    # Load a workflow definition
    workflow_path = Path(__file__).parent.parent / "workflows" / "simple_workflow.json"
    with open(workflow_path, "r") as f:
        workflow = json.load(f)
    
    # Create orchestrator and execute workflow
    orchestrator = AGNT(workflow)
    result = await orchestrator.execute({"trigger_data": "Example input"})
    
    print("\nWorkflow Execution Results:")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    asyncio.run(main())