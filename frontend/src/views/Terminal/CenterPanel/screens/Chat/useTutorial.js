import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import { resolveProviderKey } from '@/store/app/aiProvider.js';

export function useTutorial(emitFunction) {
  const store = useStore();

  // Check if an AI provider is configured
  const hasAIProvider = computed(() => {
    // Check if a provider is selected AND connected
    const selectedProvider = store.state.aiProvider?.selectedProvider;
    const connectedApps = store.state.appAuth?.connectedApps || [];

    if (!selectedProvider) return false;

    // Local provider doesn't appear in connectedApps - it's available when the server is running
    if (selectedProvider.toLowerCase() === 'local') {
      return true;
    }

    // Normalize provider key for comparison (e.g. "Z.AI" → "zai")
    const providerKey = resolveProviderKey(selectedProvider);
    return connectedApps.some((app) => app.toLowerCase() === providerKey);
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
      target: '.input-container',
      position: 'top',
      title: '⌨️ Message Input',
      content: 'This is where you type your messages. Press Enter to send, or use the buttons on the right for more options!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-attach-button',
      position: 'top',
      title: '📎 Attach Files',
      content: 'Click here to attach files to your message. I can read PDFs, images, code files, and more to help you with your tasks!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-provider-button',
      position: 'top',
      title: '🤖 AI Provider',
      content: 'Switch between AI providers and models on the fly. Pick the best model for each task without leaving the chat!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-mic-button',
      position: 'top',
      title: '🎙️ Voice Input',
      content: "Prefer talking over typing? Click here to use voice input. I'll transcribe your speech into a message for you!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-send-button',
      position: 'top',
      title: '📨 Send Message',
      content:
        "Click this button or press Enter to send your message. When I'm responding, this turns into a stop button so you can interrupt me anytime!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.suggestions-bar',
      position: 'top',
      title: '⚡ Quick Actions',
      content: "Not sure what to ask? I've got some suggestions here to get you started. Click any one to send it instantly, or type your own!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.chat-actions-bar',
      position: 'top',
      title: '🛠️ Save & Clear',
      content: 'Use the save button to manually save our conversation, or the clear button to start fresh. Your chats are also auto-saved!',
      buttonText: 'Next',
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
      content: "This panel holds detailed monitoring info. Let me open it up and show you what's inside!",
      buttonText: 'Check it out',
      highlightTarget: true,
      enforceStep: false,
      onBefore: async () => {
        // Expand the monitoring panel if it's collapsed
        const panel = document.querySelector('.monitoring-panel');
        if (panel && panel.classList.contains('collapsed')) {
          const header = panel.querySelector('.monitoring-header');
          if (header) header.click();
        }
      },
    },
    {
      target: '.context-monitor',
      position: 'bottom',
      title: '📈 Context Usage',
      content:
        "This tracks how much of the AI's context window is being used. Keep an eye on it during long conversations to know when context is getting full!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.health-panel',
      position: 'bottom',
      title: '💚 System Health',
      content:
        "Real-time health metrics for your system—uptime, errors caught, and tool performance. If something goes wrong, you'll see it here first!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.activity-feed',
      position: 'bottom',
      title: '📋 Activity Feed',
      content:
        "A live log of everything happening in the system—workflow runs, tool calls, and more. Great for debugging or just seeing what's going on behind the scenes!",
      buttonText: 'Got It',
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
