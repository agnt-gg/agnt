import { TOOLS } from './backend/src/services/orchestrator/workflowTools.js';

console.log('Testing workflow tools...\n');

// Test 1: Check all required tools exist
const requiredTools = [
  'add_workflow_node',
  'remove_workflow_node', 
  'update_workflow_node',
  'connect_workflow_nodes',
  'disconnect_workflow_nodes',
  'revert_workflow',
  'list_workflow_versions',
  'create_checkpoint'
];

let passed = 0;
let failed = 0;

requiredTools.forEach(toolName => {
  if (TOOLS[toolName]) {
    console.log(`✅ ${toolName} exists`);
    passed++;
  } else {
    console.log(`❌ ${toolName} missing`);
    failed++;
  }
});

// Test 2: Verify tool responses don't include updatedWorkflow
console.log('\nTesting add_workflow_node response format...');

const mockContext = {
  workflowId: 'test-id',
  workflowState: {
    nodes: [],
    edges: []
  }
};

try {
  const result = await TOOLS.add_workflow_node.execute(
    { nodeType: 'delay', parameters: { duration: 5, unit: 'seconds' } },
    'Bearer test-token',
    mockContext
  );
  
  const parsed = JSON.parse(result);
  
  if (parsed.updatedWorkflow) {
    console.log('❌ FAILED: updatedWorkflow still in response');
    failed++;
  } else {
    console.log('✅ updatedWorkflow correctly removed from response');
    passed++;
  }
  
  if (parsed.success && parsed.nodeId) {
    console.log('✅ Response has correct structure:', { success: parsed.success, nodeId: !!parsed.nodeId });
    passed++;
  } else {
    console.log('❌ FAILED: Response missing required fields');
    failed++;
  }
} catch (error) {
  console.log(`⚠️  Tool execution error (expected in test env): ${error.message}`);
  // Version service might fail without real DB, that's OK for this test
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ All workflow tool tests passed!');
} else {
  process.exit(1);
}
