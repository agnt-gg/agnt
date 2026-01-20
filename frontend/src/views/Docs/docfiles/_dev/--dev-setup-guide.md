# ⚡ AGNT.gg Developer Quick Start Guide

Welcome to the AGNT.gg developer setup guide! This guide will walk you through setting up the AGNT.gg Community Core app on your own machine. Let's get started! 🎉

## 📋 Prerequisites

Before we begin, make sure you have the following installed:

- Node.js (v18 or later)
- npm (v8 or later)
- Git

## 🌿 Clone the Repository

Open your terminal and run:

```bash
git clone https://github.com/agnt/community-core
cd agnt-ai
```

## 🖥️ Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Copy the `.example.env` file and save as `.env`:
```bash
cp .example.env .env
```

4. Open the new `.env` file and save your environment variables:
```bash
# CREATE A JWT AND SESSION SECRET
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here

# SET YOUR ENV VARIABLES FOR ALL THIRD PARTY APPS NEEDED
OPENAI_API_KEY=your_openai_api_key_here
CLAUDE_API_KEY=your_claude_api_key_here

# more as needed....
```

5. Start the backend server:
```bash
npm run dev
```

## 🎨 Frontend Setup

1. Open a new terminal window and navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Open the `user.config.js` file and update the frontend user variables:
```javascript
// *** USER CONFIGURATIONS ***
// ***************************

// EMAIL DOMAIN TO USE FOR SENDING / RECEIVING
export const IMAP_EMAIL_DOMAIN = {
  BASE_DOMAIN: "yourdomain.com", // CHANGE THIS TO YOUR EMAIL DOMAIN!
};

// ADD LLM PROVIDERS / MODELS TO FRONT END 
export const AI_PROVIDERS_CONFIG = {
  providers: ["OpenAI", "Anthropic", "TogetherAI"],
  modelsByProvider: {
    OpenAI: ["gpt-4o-mini", "gpt-4o"],
    Anthropic: ["claude-3-haiku-20240307", "claude-3-5-sonnet-20240620"],
    TogetherAI: ["mistralai/Mixtral-8x22B-Instruct-v0.1","meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",],
  },
};
```

4. Start the frontend development server:
```bash
npm run dev
```

## 🌐 Accessing the Application

Once both servers are running, access the application in your web browser:

- Frontend: `http://localhost:5173` (or the port specified in user.config.js)
- Backend API: `http://localhost:3333` (or the port specified in your .env file)

## 🐛 Troubleshooting

If you encounter any issues during setup, please check the following:

- Ensure all required dependencies are installed.
- Verify that the specified ports are not being used by other applications.
- Ensure that the `API_CONFIG.BASE_URL` in the frontend `user.config.js` matches your backend server address and port. (port 3333 by default)

💡 Pro Tip: Use the debug mode in your IDE or browser developer tools to step through your code and identify where issues occur.

## 🚀 Next Steps

Now that you have your local development environment set up, you're ready to start building with AGNT.gg! Here are some suggested next steps:

1. 📚 Explore the project structure and familiarize yourself with the codebase.
2. 🧪 Try making your own tools and workflows to see how the application works.
3. 🐞 Set up your debugging environment for more efficient development.
4. 📝 Review the existing documentation and consider contributing to it.

## 🔗 More Resources

- [Mastering the Workflow Designer](/docs/dev/--workflow-designer)
- [Tool Forge Essentials](/docs/dev/--tool-forge)
- [Coding Your Own Advanced Tools](/docs/dev/coding-new-tools)

Happy coding! 🛠️💻

