import { ref } from 'vue';

export function useTutorial() {
  const tutorialConfig = ref([
    {
      target: '.secrets-content',
      position: 'center',
      title: 'Welcome to AGNT.gg!',
      content: 'Get started with a quick tour of the app from Annie, your dedicated AI assistant.',
      buttonText: 'Take a Tour With Annie',
      hideArrow: true,
    },
    {
      target: '.secrets-content',
      position: 'center',
      title: 'Welcome to Integrations!',
      content:
        "Let's get you started by connecting your apps. This is your central hub for managing integrations, API keys, and secure credentials. Let's take a tour of all the features available.",
      buttonText: 'Get Connected',
      hideArrow: true,
      media: {
        type: 'gif',
        src: '/tutorial-assets/welcome-to-agnt.gif',
      },
      audioContent: '/tutorial-assets/welcome-to-agnt.mp3',
    },
    {
      target: '.secrets-content',
      position: 'left',
      title: '📱 App Integrations',
      content:
        'Click "Connect" to connect your first app. Start with an AI provider such as OpenAI, Anthropic, Grok, etc - as your AI provider will help power everything else within AGNT.',
      buttonText: 'Next',
      highlightTarget: true,
      media: {
        type: 'gif',
        src: '/tutorial-assets/app-integration.gif',
      },
      audioContent: '/tutorial-assets/app-integration.mp3',
    },
    // {
    //   target: '.nav-item:nth-child(1)',
    //   position: 'right',
    //   title: '🔌 App Connections',
    //   content: 'Connect to external apps via OAuth or API keys. This includes services like Google, OpenAI, GitHub, Slack, and more.',
    //   buttonText: 'Next',
    //   highlightTarget: true,
    //   enforceStep: false,
    // },
    {
      target: '[data-nav="providers"]',
      position: 'right',
      title: '🤖 Global AI Provider',
      content: 'Choose your default AI provider selection. This is essential for your AI-powered assistants throughout the app.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
      media: {
        type: 'gif',
        src: '/tutorial-assets/welcome-to-agnt.gif',
      },
      audioContent: '/tutorial-assets/default-ai-provider.mp3',
    },
    {
      target: '.nav-item:nth-child(3)',
      position: 'right',
      title: '🔧 MCP / NPM Library',
      content: 'Access the Model Context Protocol (MCP) servers and NPM library integrations. Extend AGNT with custom tools and capabilities.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.nav-item:nth-child(4)',
      position: 'right',
      title: '🔗 Webhooks',
      content: 'Configure webhook endpoints for receiving real-time notifications and data from external services. This is a PRO feature.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.nav-item:nth-child(5)',
      position: 'right',
      title: '📧 Email Server',
      content: 'Set up your email server configuration for sending and receiving emails through AGNT workflows. This is a PRO feature.',
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.secrets-content',
      position: 'center',
      title: '💡 Pro Tips',
      content: 'Remember: Connect your AI provider first, then add other integrations as needed. All credentials are encrypted and stored securely!',
      buttonText: 'Next',
      hideArrow: true,
    },
    {
      target: '.secrets-content',
      position: 'center',
      title: '🎉 Tour Complete!',
      content:
        "You're now ready to manage your integrations! Start by connecting essential services like AI providers (OpenAI, Anthropic), then add other integrations as needed for your workflows.",
      buttonText: 'Start Connecting!',
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-SecretsScreen-completed', 'true');
  };

  const nextStep = () => {
    if (currentStep.value < tutorialConfig.value.length - 1) {
      currentStep.value++;
    } else {
      onTutorialClose();
    }
  };

  const initializeTutorial = () => {
    startTutorial.value = true;
    currentStep.value = 0;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeTutorial,
  };
}
