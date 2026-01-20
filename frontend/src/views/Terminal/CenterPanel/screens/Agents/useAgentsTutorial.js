import { ref } from 'vue';

export function useAgentsTutorial() {
  const tutorialConfig = ref([
    {
      target: '.agents-panel',
      position: 'center',
      title: '🤖 Welcome to Agents!',
      content:
        'This is where you manage your AI agents. Think of agents as your automated assistants - each one can run independently, use tools, and execute workflows to help you get things done.',
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '.sticky-header',
      position: 'bottom',
      title: '📊 Agent Tabs & Views',
      content:
        "I've organized your agents into tabs - All, Active, and Inactive. Switch between grid and table views, and use the search bar to find specific agents quickly.",
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.category-cards-container',
      position: 'center',
      title: '🗂️ Agent Categories',
      content:
        "Your agents are grouped by category to keep things organized. You can drag and drop agents between categories, and collapse categories you don't need right now.",
      buttonText: 'Got It',
      highlightTarget: true,
      hideArrow: true,
      enforceStep: false,
    },
    {
      target: '.agent-card',
      position: 'right',
      title: '🎯 Agent Cards',
      content:
        'Each agent card shows its status, description, and assigned tools. Click any agent to see its full details and configuration in the panel below.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
      action: () => {
        // This will be called when user clicks Next
        // The tutorial system will handle moving to the next step
      },
    },
    {
      target: '.agent-details-section',
      position: 'top',
      title: '⚙️ Agent Details',
      content:
        "Here you can configure your agent - assign tools and workflows, set AI provider and model, adjust performance settings, and manage goals. This is your agent's control center!",
      buttonText: 'Makes Sense',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.agents-panel',
      position: 'center',
      title: "✅ You're Ready!",
      content:
        "Now you can create, configure, and manage your AI agents. Each agent can work independently to automate tasks and help you achieve your goals. Let's build something amazing!",
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-AgentsScreen-completed', 'true');
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

  const initializeAgentsTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeAgentsTutorial,
  };
}
