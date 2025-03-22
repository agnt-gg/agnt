import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import AGNT from './orchestrator/AGNT.js';
import SPRK from './orchestrator/SPRK.js';

// Load environment variables
dotenv.config();

// Get the directory name properly in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

const sprk = new SPRK();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get list of available workflows
app.get('/api/workflows', (req, res) => {
  const workflowsDir = path.resolve(__dirname, 'workflows');
  try {
    const files = fs.readdirSync(workflowsDir)
      .filter(file => file.endsWith('.json'));
    
    const workflows = files.map(file => {
      const filePath = path.join(workflowsDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        id: content.id,
        name: content.name,
        filename: file
      };
    });
    
    res.json(workflows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get workflow details
app.get('/api/workflows/:filename', (req, res) => {
  const workflowPath = path.resolve(__dirname, 'workflows', req.params.filename);
  try {
    if (!fs.existsSync(workflowPath)) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run workflow
app.post('/api/run/:filename', async (req, res) => {
  // Fix: Handle filename with or without .json extension
  let filename = req.params.filename;
  if (!filename.endsWith('.json')) {
    filename += '.json';
  }
  
  const workflowPath = path.resolve(__dirname, 'workflows', filename);
  try {
    if (!fs.existsSync(workflowPath)) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    
    console.log(`Loading workflow from: ${workflowPath}`);
    
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const agnt = new AGNT(workflow);
    await agnt.execute(req.body.inputData || {});
    
    // Gather the execution summary for the client
    const summary = agnt.getExecutionSummary();
    
    // Clean the summary to remove circular references
    const cleanSummary = {
      ...summary,
      outputs: {}
    };
    
    // Clean each node output
    Object.keys(summary.outputs).forEach(nodeId => {
      cleanSummary.outputs[nodeId] = JSON.parse(JSON.stringify(
        summary.outputs[nodeId],
        (key, value) => {
          // Skip context property to avoid circular references
          if (key === 'context') return undefined;
          return value;
        }
      ));
    });
    
    console.log('Sending response to client...');

    res.json(cleanSummary);
  } catch (error) {
    console.error('Error in /api/run endpoint:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Generate Mermaid chart for workflow
app.get('/api/chart/:filename', (req, res) => {
  const workflowPath = path.resolve(__dirname, 'workflows', req.params.filename);
  try {
    if (!fs.existsSync(workflowPath)) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const mermaidChart = generateMermaidChart(workflow);
    
    res.json({ chart: mermaidChart });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Function to generate Mermaid chart from workflow
function generateMermaidChart(workflow) {
  let chart = 'flowchart TD\n';
  
  // Add nodes
  workflow.nodes.forEach(node => {
    chart += `    ${node.id}["${node.text}"]\n`;
  });
  
  // Add edges
  workflow.edges.forEach(edge => {
    const startNode = edge.startNodeId;
    const endNode = edge.endNodeId;
    
    if (edge.condition) {
      chart += `    ${startNode} -->|${edge.condition} ${edge.value}| ${endNode}\n`;
    } else {
      chart += `    ${startNode} --> ${endNode}\n`;
    }
  });
  
  // Add styling
  chart += '\n    %% Node styling\n';
  chart += '    classDef trigger fill:#e6f7ff,stroke:#1890ff,stroke-width:2px\n';
  chart += '    classDef utility fill:#f6ffed,stroke:#52c41a,stroke-width:2px\n';
  chart += '    classDef ai fill:#fff2e8,stroke:#fa8c16,stroke-width:2px\n';
  chart += '    classDef action fill:#f9f0ff,stroke:#722ed1,stroke-width:2px\n\n';
  
  // Apply styles
  workflow.nodes.forEach(node => {
    chart += `    class ${node.id} ${node.category}\n`;
  });
  
  return chart;
}

// Generate a simple favicon
app.get('/favicon.ico', (req, res) => {
  const faviconPath = path.join(__dirname, 'public', 'favicon.ico');
  
  // If favicon exists, serve it
  if (fs.existsSync(faviconPath)) {
    return res.sendFile(faviconPath);
  }
  
  // Otherwise, send a simple 16x16 transparent icon
  const favicon = Buffer.from('AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAA////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'base64');
  
  res.writeHead(200, {
    'Content-Type': 'image/x-icon',
    'Content-Length': favicon.length
  });
  res.end(favicon);
});

// Get list of available tools
app.get('/api/tools', (req, res) => {
  const toolsDir = path.resolve(__dirname, 'tools');
  try {
    if (!fs.existsSync(toolsDir)) {
      return res.json({ error: 'No tools directory found', tools: [] });
    }
    
    // Read all JS files from the tools directory (excluding the library file)
    const files = fs.readdirSync(toolsDir)
      .filter(file => file.endsWith('.js') && !file.startsWith('!'));
    
    const tools = files.map(file => {
      const name = file.replace('.js', '');
      // Convert kebab-case to readable name
      const readableName = name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      return {
        id: name,
        name: readableName,
        filename: file
      };
    });
    
    res.json({ tools });
  } catch (error) {
    res.status(500).json({ error: error.message, tools: [] });
  }
});

// Generate a tool endpoint
app.post('/api/generate/tool', async (req, res) => {
  try {
    const { description, options = {} } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Tool description is required' });
    }
    
    const result = await sprk.generateTool(description, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate a workflow endpoint
app.post('/api/generate/workflow', async (req, res) => {
  try {
    const { description, options = {} } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Workflow description is required' });
    }
    
    const result = await sprk.generateWorkflow(description, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve tool files for viewing
app.get('/tools/:filename', (req, res) => {
  const toolPath = path.resolve(__dirname, 'tools', req.params.filename);
  
  try {
    if (!fs.existsSync(toolPath)) {
      return res.status(404).send('Tool not found');
    }
    
    const content = fs.readFileSync(toolPath, 'utf8');
    res.set('Content-Type', 'text/plain');
    res.send(content);
  } catch (error) {
    res.status(500).send(`Error reading tool file: ${error.message}`);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}\n`);
});