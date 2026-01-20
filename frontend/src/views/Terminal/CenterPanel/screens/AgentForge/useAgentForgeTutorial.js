import { ref } from 'vue';

export function useAgentForgeTutorial() {
  const tutorialConfig = ref([
    {
      target: '.agentforge-content',
      position: 'center',
      title: '🤖 Welcome to Agent Forge!',
      content: "This is where the magic happens! I'll help you create custom AI agents with specific skills and personalities to automate your work.",
      buttonText: "Let's Build",
      hideArrow: true,
    },
    {
      target: '.two-column-row',
      position: 'bottom',
      title: '👤 Agent Identity',
      content: 'First, give your agent a personality! Upload an avatar, choose a name, and select the AI model that will power their brain.',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.bio-card',
      position: 'top',
      title: '📝 Description',
      content: 'Describe what your agent does. This helps you (and others) understand their role and expertise at a glance.',
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.capabilities-card',
      position: 'top',
      title: '🛠️ Tools & Workflows',
      content:
        'This is the fun part! Equip your agent with tools and workflows. This defines what they can actually *do* - from searching the web to running complex tasks.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.agent-form',
      position: 'center',
      title: '🚀 Ready to Launch?',
      content: "Once you've set everything up, just hit the create button. Your new agent will be ready to help you automate your tasks in no time!",
      buttonText: "Let's Create!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-AgentForgeScreen-completed', 'true');
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

  const initializeAgentForgeTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeAgentForgeTutorial,
  };
}
