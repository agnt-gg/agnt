import { VM } from 'vm2';
import fetch from 'node-fetch';
import axios from 'axios';

export async function execute(params, inputData) {
  try {
    // Get code from parameters
    const code = params?.code || '';
    
    // If no code is provided, return a helpful error
    if (!code || code.trim() === '') {
      return { 
        error: "No JavaScript code provided. Please provide code to execute.",
        executed: false 
      };
    }
    
    console.log("Executing JS code:", code);
    
    // Don't add return statement, instead wrap the code in a function
    let wrappedCode;
    
    // Check if the code contains async/await
    const isAsync = code.includes('async') || code.includes('await');
    
    // If code has async/await, we need special handling
    if (isAsync) {
      wrappedCode = `(async function() { 
        try {
          ${code.includes('return ') ? code : `return ${code}`}
        } catch (e) {
          return { error: e.message };
        }
      })()`;
    } 
    // Check if the code already contains a return statement
    else if (code.includes('return ') || code.trim().startsWith('return ')) {
      // If it has a return statement, wrap it in a function
      wrappedCode = `(function() { 
        try {
          ${code}
        } catch (e) {
          return { error: e.message };
        }
      })()`;
    } else {
      // If it doesn't have a return statement, use a simpler approach
      wrappedCode = `(${code})`;
    }
    
    console.log("Modified JS code:", wrappedCode);
    
    // Create a sandbox with inputData and web APIs available
    const sandbox = { 
      inputData,
      // Basic JavaScript objects
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      
      // Web APIs
      fetch: fetch,
      axios: axios,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      
      // Console with logging
      console: { 
        log: (...args) => console.log('VM log:', ...args),
        error: (...args) => console.error('VM error:', ...args),
        warn: (...args) => console.warn('VM warn:', ...args),
        info: (...args) => console.info('VM info:', ...args)
      }
    };
    
    // Create VM with a longer timeout for API calls
    const vm = new VM({
      timeout: 5000, // 5 seconds to allow for API calls
      sandbox,
      eval: false,
      wasm: false
    });
    
    // Execute the code in the VM
    const rawResultPromise = vm.run(wrappedCode);
    
    // Handle both async and sync results
    let rawResult;
    if (rawResultPromise instanceof Promise) {
      rawResult = await rawResultPromise;
    } else {
      rawResult = rawResultPromise;
    }
    
    console.log("JavaScript execution result:", rawResult);
    
    // Return the result
    return { result: rawResult, executed: true };
  } catch (error) {
    console.error("JavaScript execution error:", error);
    return { error: error.message, executed: false };
  }
}