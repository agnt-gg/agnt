import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import AuthManager from '../../../services/auth/AuthManager.js';
import PathManager from '../../../utils/PathManager.js';
import os from 'os';

class AIBrowserUse extends BaseAction {
  static schema = {
    title: 'Browser Agent',
    category: 'action',
    type: 'ai-browser-use',
    icon: 'web',
    description: 'Executes instructions using Browser Use to run browser automation tasks.',
    parameters: {
      instructions: {
        type: 'string',
        inputType: 'textarea',
        description: 'Instructions for the browser automation task.',
      },
      provider: {
        type: 'string',
        inputType: 'select',
        options: ['OpenAI', 'Gemini', 'DeepSeek'],
        default: 'OpenAI',
        description: 'Which LLM provider to use.',
      },
    },
    outputs: {
      result: {
        type: 'string',
        description: 'Text result from the automation',
      },
      gifPath: {
        type: 'string',
        description: 'Path or URL to the generated GIF',
      },
      error: {
        type: 'string',
        description: 'Error message if the tool fails',
      },
    },
  };

  constructor() {
    super('ai-browser-use');
    this.browser = null; // Store browser instance
  }

  async execute(params, inputData, workflowEngine) {
    try {
      // 1) Validate instructions
      const userInstructions = params.instructions || 'No instructions provided';

      // 2) Get or default the chosen provider
      const provider = params.provider || 'openai';

      // 3) Get browser reuse setting
      const reuseBrowser = params.reuseBrowser === true;

      // 4) Fetch user's API key
      let apiKey;
      try {
        apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, provider);
      } catch (authErr) {
        throw new Error(`Failed to retrieve API key for ${provider}: ${authErr.message || authErr}`);
      }
      if (!apiKey) {
        throw new Error(`${provider.toUpperCase()} API key is missing or invalid. Please authenticate.`);
      }

      // 5) Run Python snippet (model is now hard-coded)
      const { result, gifPath } = await this.runPythonSnippet(userInstructions, apiKey, provider, reuseBrowser);

      // 6) Return success
      return this.formatOutput({
        success: true,
        result,
        gifPath,
        error: null,
      });
    } catch (err) {
      console.error('AI Browser Use Error:', err);
      return this.formatOutput({
        success: false,
        result: null,
        gifPath: null,
        error: err.message || 'Unknown error occurred',
      });
    }
  }

  /**
   * The runPythonSnippet method now supports browser reuse
   */
  async runPythonSnippet(userInstructions, apiKey, provider, reuseBrowser) {
    // First, ensure required packages are installed and get the venv python executable
    const pythonExecutable = await this.installRequiredPackages();

    // Escape special chars in user instructions
    const sanitizedInstructions = userInstructions.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let importLine = '';
    let llmLine = '';
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

    // Hard-code model for each provider
    if (provider === 'Gemini') {
      importLine = 'from browser_use.llm import ChatGoogleGenerativeAI';
      llmLine = `llm=ChatGoogleGenerativeAI(model='gemini-2.0-flash')`;
      env['GOOGLE_API_KEY'] = apiKey;
    } else if (provider === 'DeepSeek') {
      importLine = 'from browser_use.llm import ChatOpenAI';
      llmLine = `
llm=ChatOpenAI(
    base_url='https://api.deepseek.com/v1',
    model='deepseek-reasoner'
)`;
      env['DEEPSEEK_API_KEY'] = apiKey;
    } else {
      // Default to OpenAI
      importLine = 'from browser_use.llm import ChatOpenAI';
      llmLine = `llm=ChatOpenAI(model='gpt-4o')`;
      env['OPENAI_API_KEY'] = apiKey;
    }

    // Generate a unique identifier for the browser instance
    const browserInstanceId = reuseBrowser ? 'persistent_browser' : `browser_${randomBytes(4).toString('hex')}`;

    // No leading indentation:
    const pythonCode = `
import os
import sys
import asyncio
import json
from dotenv import load_dotenv
import certifi

# Set SSL certificate file for macOS/extensions
os.environ['SSL_CERT_FILE'] = certifi.where()

load_dotenv()

${importLine}
from browser_use import Agent, Browser

task = """${sanitizedInstructions}"""

# Check if we have a persistent browser
BROWSER_STATE_FILE = "browser_state.json"
browser_data = {}
if os.path.exists(BROWSER_STATE_FILE):
    try:
        with open(BROWSER_STATE_FILE, 'r') as f:
            browser_data = json.load(f)
    except:
        browser_data = {}

async def main():
    try:
        # Initialize or reuse browser
        browser = None
        reuse_browser = ${reuseBrowser ? 'True' : 'False'}
        browser_id = "${browserInstanceId}"
        
        if reuse_browser and browser_id in browser_data:
            try:
                # Try to reconnect to existing browser
                browser = Browser(id=browser_id)
                print("Reusing existing browser session")
            except Exception as e:
                print(f"Failed to reconnect to browser: {e}")
                browser = None
        
        if browser is None:
            browser = Browser(id=browser_id)
        
        # Create and run agent with the browser
        agent = Agent(
            task=task,
            ${llmLine},
            browser=browser,
            generate_gif=True
        )
        await agent.run()
        
        # Save browser state for future reuse if needed
        if reuse_browser:
            browser_data[browser_id] = {"active": True, "last_used": browser.wsEndpoint}
            with open(BROWSER_STATE_FILE, 'w') as f:
                json.dump(browser_data, f)
            
            # Don't close the browser if we want to reuse it
            print("Browser instance kept alive for future use")
        else:
            # Close browser only if not reusing
            await browser.close()
            
    except Exception as e:
        print(e, file=sys.stderr)

asyncio.run(main())
`.trim();

    return new Promise((resolve, reject) => {
      // Use PathManager to get the working directory (userData)
      const workingDir = PathManager.getUserDataPath();

      const child = spawn(pythonExecutable, ['-u', '-c', pythonCode], {
        env,
        cwd: workingDir,
      });

      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Python script timed out after 10 minutes.'));
      }, 600000);

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Python stdout:', output);
        stdoutData += output;
      });

      child.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error('Python stderr:', errorOutput);
        stderrData += errorOutput;
      });

      child.on('close', async (code) => {
        clearTimeout(killTimer);

        if (code === 0) {
          const workingDir = PathManager.getUserDataPath();
          // Attempt to move agent_history.gif to /backend/media/gifs
          const defaultGifFile = path.join(workingDir, 'agent_history.gif');
          const randomSuffix = randomBytes(4).toString('hex');
          const newGifFileName = `agent_history_${randomSuffix}.gif`;
          let renamedGifPath = null;

          if (fs.existsSync(defaultGifFile)) {
            try {
              // Use user data directory for media/gifs as well
              const gifsDirectory = PathManager.getPath('media', 'gifs');

              if (!fs.existsSync(gifsDirectory)) {
                fs.mkdirSync(gifsDirectory, { recursive: true });
              }
              const newGifPath = path.join(gifsDirectory, newGifFileName);
              fs.renameSync(defaultGifFile, newGifPath);
              renamedGifPath = newGifFileName;
            } catch (renameErr) {
              return reject(new Error(`Failed to rename the GIF: ${renameErr.message}`));
            }
          }

          resolve({
            result: stdoutData.trim(),
            gifPath: renamedGifPath,
          });
        } else {
          reject(new Error(stderrData.trim() || `AI Browser Use script exited with code ${code || 'unknown'}`));
        }
      });
    });
  }

  async installRequiredPackages() {
    // Use PathManager for the working directory
    const workingDir = PathManager.getUserDataPath();
    const venvPath = path.join(workingDir, 'browser_use_venv');
    const isWin = process.platform === 'win32';
    const venvPython = isWin ? path.join(venvPath, 'Scripts', 'python.exe') : path.join(venvPath, 'bin', 'python');

    const pipExecutable = isWin ? path.join(venvPath, 'Scripts', 'pip.exe') : path.join(venvPath, 'bin', 'pip');

    // Helper to find python executable
    const findPython = async () => {
      if (isWin) return 'python';

      // On Linux/Mac, try python3 first, then python
      return new Promise((resolve) => {
        const checkPython3 = spawn('python3', ['--version']);
        checkPython3.on('error', () => {
          resolve('python'); // Fallback to python
        });
        checkPython3.on('close', (code) => {
          resolve(code === 0 ? 'python3' : 'python');
        });
      });
    };

    // 1. Check if venv/pip exists. If not, create/repair it.
    if (!fs.existsSync(venvPath) || !fs.existsSync(pipExecutable)) {
      console.log('Creating or repairing Python virtual environment at:', venvPath);

      // Step 1: Create venv without pip (only if it doesn't exist to avoid overwriting)
      if (!fs.existsSync(venvPath)) {
        const systemPython = await findPython();
        console.log(`Using system python: ${systemPython}`);

        await new Promise((resolve, reject) => {
          // Use --without-pip to avoid error if ensurepip is missing
          const venvProcess = spawn(systemPython, ['-m', 'venv', '--without-pip', venvPath], {
            cwd: workingDir,
          });

          let stderrOutput = '';
          venvProcess.stdout.on('data', (d) => console.log(`Venv creation stdout: ${d}`));
          venvProcess.stderr.on('data', (d) => {
            const msg = d.toString();
            stderrOutput += msg;
            console.error(`Venv creation stderr: ${msg}`);
          });

          venvProcess.on('close', (code) => {
            if (code === 0) resolve();
            else {
              let errorMsg = `Failed to create venv. Exit code: ${code}. `;
              if (stderrOutput.includes('apt install python3-venv')) {
                errorMsg += 'Missing venv module. Please install it (e.g., sudo apt install python3-venv).';
              }
              reject(new Error(errorMsg));
            }
          });
          venvProcess.on('error', (err) => {
            reject(new Error(`Failed to spawn venv process: ${err.message}`));
          });
        });
      }

      // Step 2: Download get-pip.py
      console.log('Downloading get-pip.py...');
      const getPipPath = path.join(workingDir, 'get-pip.py');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(getPipPath);
        https
          .get('https://bootstrap.pypa.io/get-pip.py', (response) => {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          })
          .on('error', (err) => {
            fs.unlink(getPipPath, () => {}); // Delete the file async. (But we don't check result)
            reject(new Error(`Failed to download get-pip.py: ${err.message}`));
          });
      });

      // Step 3: Install pip into the venv
      console.log('Installing pip into venv...');
      await new Promise((resolve, reject) => {
        // IMPORTANT: Use the full path to the python executable in the venv
        const installPipProcess = spawn(venvPython, [getPipPath], {
          cwd: workingDir,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        installPipProcess.stdout.on('data', (d) => console.log(`Pip install stdout: ${d}`));
        installPipProcess.stderr.on('data', (d) => console.error(`Pip install stderr: ${d}`));

        installPipProcess.on('close', (code) => {
          // Clean up get-pip.py
          try {
            fs.unlinkSync(getPipPath);
          } catch (e) {}

          if (code === 0) resolve();
          else reject(new Error(`Failed to install pip. Exit code: ${code}`));
        });
      });
    }

    const installScriptContent = `
import subprocess
import sys
import os
import platform

def install_package(package):
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print(f"Successfully installed {package}")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install {package}: {e}", file=sys.stderr)
        sys.exit(1)

def install_from_git(repo_url):
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", f"git+{repo_url}"])
        print(f"Successfully installed {repo_url}")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install {repo_url}: {e}", file=sys.stderr)
        sys.exit(1)

def check_git_installed():
    try:
        subprocess.run(["git", "--version"], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

required_packages = [
    'python-dotenv', 'langchain', 'langchain_openai', 'langchain_google_genai',
    'pydantic', 'selenium', 'webdriver_manager', 'beautifulsoup4', 'playwright',
    'pillow', 'numpy', 'requests', 'aiohttp', 'certifi'
]

if not check_git_installed():
    print("Git not found. Please install Git manually.")
    sys.exit(1)

should_install_browsers = False

for package in required_packages:
    try:
        __import__(package.replace('-', '_').split('[')[0])
        print(f"{package} is already installed")
    except ImportError:
        print(f"Installing {package}...")
        install_package(package)
        if package == 'playwright':
            should_install_browsers = True

browser_use_repo = "https://github.com/browser-use/browser-use.git"
try:
    import browser_use
    print("browser-use is already installed")
except ImportError:
    print("Installing browser-use from GitHub...")
    install_from_git(browser_use_repo)

if should_install_browsers:
    print("Installing Playwright browsers...")
    try:
        subprocess.check_call([sys.executable, "-m", "playwright", "install"])
        print("Playwright browsers installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install Playwright browsers: {e}", file=sys.stderr)
        sys.exit(1)
else:
    print("Playwright browsers check skipped (package already installed)")

print("All packages installed successfully")
`;

    // Write the install script to a temporary file
    const tempScriptPath = path.join(os.tmpdir(), 'install_packages.py');
    fs.writeFileSync(tempScriptPath, installScriptContent);

    return new Promise((resolve, reject) => {
      // Use the venv python executable
      const installProcess = spawn(venvPython, [tempScriptPath], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PATH: process.env.PATH,
        },
      });

      let stdoutData = '';
      let stderrData = '';

      installProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
        console.log('Package installation:', data.toString());
      });

      installProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.error('Package installation error:', data.toString());
      });

      installProcess.on('close', (code) => {
        // Clean up the temporary script file
        fs.unlinkSync(tempScriptPath);

        if (code === 0) {
          console.log('Package installation completed successfully');
          resolve(venvPython);
        } else {
          console.error('Package installation failed with code:', code);
          console.error('Stdout:', stdoutData);
          console.error('Stderr:', stderrData);
          reject(new Error(`Failed to install required Python packages. Exit code: ${code}`));
        }
      });
    });
  }

  formatOutput(output) {
    return {
      ...output,
      outputs: {
        success: output.success,
        result: output.result,
        gifPath: output.gifPath,
        error: output.error,
      },
    };
  }
}

export default new AIBrowserUse();
