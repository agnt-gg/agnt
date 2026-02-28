import { ref, computed } from 'vue';
import { useStore } from 'vuex';

export function useTutorial(emitFunction) {
  const store = useStore();

  // Check if an AI provider is configured
  const hasAIProvider = computed(() => {
    // Check if a provider is selected AND connected
    const selectedProvider = store.state.aiProvider?.selectedProvider;
    const connectedApps = store.state.appAuth?.connectedApps || [];

    if (!selectedProvider) return false;

    // Local provider doesn't appear in connectedApps - it's available when the server is running
    // This check should match the logic in Chat.vue's hasConnectedAIProvider
    if (selectedProvider.toLowerCase() === 'local') {
      // We can't directly check isLocalServerRunning here, but if Local is selected,
      // assume it's available (the Chat.vue logic will handle the actual check)
      return true;
    }

    // Check if the selected provider is in the connected apps (case-insensitive)
    return connectedApps.some((app) => app.toLowerCase() === selectedProvider.toLowerCase());
  });

  const tutorialConfig = ref([
    {
      target: '.conversation-canvas',
      position: 'center',
      title: computed(() => {
        if (!hasAIProvider.value) {
          return '⚠️ No AI Provider Connected';
        }
        return "💬 Hi! I'm Annie";
      }),
      content: computed(() => {
        if (!hasAIProvider.value) {
          return "Before we can chat, you'll need to connect an AI provider. Click below and I'll help you set one up in the Integrations section.";
        }
        return "Welcome to our chat space! I'm your AI assistant, and I'm here to help you automate tasks, answer questions, and build workflows. Just type your message below and let's get started!";
      }),
      buttonText: computed(() => {
        if (!hasAIProvider.value) {
          return 'Go to Integrations';
        }
        return 'Show Me Around';
      }),
      hideArrow: true,
      navigateToScreen: computed(() => {
        // Only navigate if no provider is set
        return !hasAIProvider.value ? 'ConnectorsScreen' : null;
      }),
    },
    {
      target: '.engine-header',
      position: 'bottom',
      title: '📊 System Status',
      content:
        "Up here, I show you real-time metrics about your system—active workflows, response times, and success rates. I keep an eye on these so you don't have to!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.monitoring-panel',
      position: 'bottom',
      title: '🔍 System Monitoring',
      content:
        "Click here to see detailed monitoring info. I'll show you context usage, system health, and activity logs. Super helpful when you need to debug or optimize!",
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.conversation-canvas',
      position: 'center',
      title: '💭 Our Conversation Space',
      content:
        "This is where we'll chat! All our messages appear here. When I'm thinking or using tools to help you, I'll let you know what I'm doing.",
      buttonText: 'Next',
      highlightTarget: true,
      hideArrow: true,
    },
    {
      target: '.quick-actions',
      position: 'top',
      title: '⚡ Quick Actions',
      content: "Not sure what to ask? I've got some suggestions here to get you started. Click any one to send it instantly, or type your own!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-actions',
      position: 'top',
      title: '🛠️ Chat Controls',
      content: "These buttons let you clear our conversation or save it for later. I'll remember everything when you load a saved chat!",
      buttonText: 'Makes Sense',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.conversation-canvas',
      position: 'center',
      title: "✅ We're Ready!",
      content: "That's everything! Go ahead and ask me anything, or try one of the quick actions below. I'm here to help you succeed!",
      buttonText: "Let's Chat!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);

  const onTutorialClose = () => {
    startTutorial.value = false;
    // Only mark as completed if a provider is connected
    if (hasAIProvider.value) {
      localStorage.setItem('tutorial-screen-1-completed', 'true');
    }
  };

  // Only skip tutorial if completed AND provider is connected
  const shouldSkipTutorial = localStorage.getItem('tutorial-screen-1-completed') === 'true' && hasAIProvider.value;
  if (shouldSkipTutorial) {
    // startTutorial.value = false; // Uncomment if you don't want it to restart every time
  }

  return {
    tutorialConfig,
    startTutorial,
    onTutorialClose,
  };
}
