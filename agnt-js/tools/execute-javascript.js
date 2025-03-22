export async function execute(params, inputData) {
  try {
    // Create a function that has access to inputData
    const code = params.code || '';
    console.log("Executing JS code:", code);
    
    // Make sure we return the result by adding 'return' if it's not already there
    // This is needed because Function constructor body needs explicit returns
    let modifiedCode = code.trim();
    if (!modifiedCode.includes('return ') && !modifiedCode.startsWith('return ')) {
      modifiedCode = `return ${modifiedCode}`;
    }
    
    // Create and execute the function
    const func = new Function('inputData', modifiedCode);
    const rawResult = func(inputData);
    
    console.log("JavaScript execution result:", rawResult);
    
    // Ensure we always return a proper object with a result property
    if (rawResult === null || rawResult === undefined) {
      return { result: null, executed: true };
    } else if (typeof rawResult === 'object') {
      // If already an object, ensure it has a result property
      return { ...rawResult, executed: true };
    } else {
      // Otherwise wrap the primitive value as a result
      return { result: rawResult, executed: true };
    }
  } catch (error) {
    console.error("JavaScript execution error:", error);
    return { error: error.message, executed: false };
  }
}

// import { VM } from 'vm2';
// import fetch from 'node-fetch';
// import axios from 'axios';

// export async function execute(params, inputData) {
//   try {
//     // Get code from parameters
//     const code = params.code || '';
//     console.log("Executing JS code:", code);
    
//     // Don't add return statement, instead wrap the code in a function
//     let wrappedCode;
    
//     // Check if the code contains async/await
//     const isAsync = code.includes('async') || code.includes('await');
    
//     // If code has async/await, we need special handling
//     if (isAsync) {
//       wrappedCode = `(async function() { 
//         try {
//           ${code.includes('return ') ? code : `return ${code}`}
//         } catch (e) {
//           return { error: e.message };
//         }
//       })()`;
//     } 
//     // Check if the code already contains a return statement
//     else if (code.includes('return ') || code.trim().startsWith('return ')) {
//       // If it has a return statement, wrap it in a function
//       wrappedCode = `(function() { 
//         try {
//           ${code}
//         } catch (e) {
//           return { error: e.message };
//         }
//       })()`;
//     } else {
//       // If it doesn't have a return statement, use a simpler approach
//       wrappedCode = `(${code})`;
//     }
    
//     console.log("Modified JS code:", wrappedCode);
    
//     // Create a sandbox with inputData and web APIs available
//     const sandbox = { 
//       inputData,
//       // Basic JavaScript objects
//       Math,
//       Date,
//       JSON,
//       Array,
//       Object,
//       String,
//       Number,
//       Boolean,
//       RegExp,
//       Error,
      
//       // Web APIs
//       fetch: fetch,
//       axios: axios,
//       setTimeout: setTimeout,
//       clearTimeout: clearTimeout,
//       setInterval: setInterval,
//       clearInterval: clearInterval,
      
//       // Console with logging
//       console: { 
//         log: (...args) => console.log('VM log:', ...args),
//         error: (...args) => console.error('VM error:', ...args),
//         warn: (...args) => console.warn('VM warn:', ...args),
//         info: (...args) => console.info('VM info:', ...args)
//       }
//     };
    
//     // Create VM with a longer timeout for API calls
//     const vm = new VM({
//       timeout: 5000, // 5 seconds to allow for API calls
//       sandbox,
//       eval: false,
//       wasm: false
//     });
    
//     // Execute the code in the VM
//     const rawResultPromise = vm.run(wrappedCode);
    
//     // Handle both async and sync results
//     let rawResult;
//     if (rawResultPromise instanceof Promise) {
//       rawResult = await rawResultPromise;
//     } else {
//       rawResult = rawResultPromise;
//     }
    
//     console.log("JavaScript execution result:", rawResult);
    
//     // Return the result
//     return { result: rawResult, executed: true };
//   } catch (error) {
//     console.error("JavaScript execution error:", error);
//     return { error: error.message, executed: false };
//   }
// }