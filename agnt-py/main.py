import asyncio
import json
from pathlib import Path
import sys

# Make sure Python can find your modules
sys.path.append(str(Path(__file__).resolve().parent))

# Now import from your modules
from orchestrator import AGNT

async def main():
    # Load a workflow definition
    workflow_path = Path(__file__).parent / "workflows" / "simple_workflow.json"
    with open(workflow_path, "r") as f:
        workflow = json.load(f)
    
    # Create orchestrator and execute workflow
    orchestrator = AGNT(workflow)
    result = await orchestrator.execute({"trigger_data": "Example input"})
    
    print("\nWorkflow Execution Results:")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    asyncio.run(main()) 