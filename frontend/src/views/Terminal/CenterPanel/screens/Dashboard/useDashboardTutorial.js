import { ref } from 'vue';
import { useStore } from 'vuex';

export function useDashboardTutorial() {
  const store = useStore();

  const tutorialConfig = ref([
    {
      target: 'main-area',
      position: 'center',
      title: '👋 Welcome to Your Dashboard',
      content: "This is your command center. Here you'll see everything happening with your AI agents, workflows, and goals at a glance.",
      buttonText: 'Show Me Around',
      hideArrow: true,
      action: () => {
        store
          .dispatch('userStats/addTokens', 1000)
          .then(() => {
            console.log('Tutorial: 1000 Tokens granted to the user.');
          })
          .catch((error) => {
            console.error('Tutorial: Failed to grant tokens.', error);
          });
      },
    },
    {
      target: '.cumulative-credits-section',
      position: 'bottom',
      title: '⏱️ Time Saved',
      content: 'This shows how much compute time your AI agents have automated for you. Every second counts!',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.global-pulse-ribbon',
      position: 'bottom',
      title: '📊 Your Quick Stats',
      content: "These numbers show your active goals, agents, workflows, and recent activity. Think of it as your system's vital signs.",
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.dashboard-grid .top-row',
      position: 'bottom',
      title: '🎯 Goals, Agents & Workflows',
      content: 'Track your goals, see which agents are working, and monitor your workflow pipelines. Click any card to dive deeper.',
      buttonText: 'Got It',
      highlightTarget: true,
    },
    {
      target: '.dashboard-grid .middle-row',
      position: 'top',
      title: '🛠️ Tools & Activity',
      content: "See all your available tools and recent workflow runs. This helps you understand what's happening and what's available.",
      buttonText: 'Makes Sense',
      highlightTarget: true,
    },
    {
      target: 'main-area',
      position: 'center',
      title: "✅ You're All Set!",
      content: "That's the dashboard. Use it to monitor everything at a glance, then navigate to other pages to take action.",
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
  };

  const nextStep = () => {
    const currentStepConfig = tutorialConfig.value[currentStep.value];
    if (currentStepConfig && typeof currentStepConfig.action === 'function') {
      currentStepConfig.action();
    }

    if (currentStep.value < tutorialConfig.value.length - 1) {
      currentStep.value++;
    } else {
      onTutorialClose();
    }
  };

  const initializeDashboardTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeDashboardTutorial,
  };
}
