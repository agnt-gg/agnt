import { ref } from 'vue';

export function useWorkflowsTutorial() {
  const tutorialConfig = ref([
    {
      target: '.workflows-panel',
      position: 'center',
      title: '🔄 Welcome to Workflows!',
      content: 'This is where you can manage all your automation workflows - create, organize, monitor, and control them all from one place.',
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '.sticky-header',
      position: 'bottom',
      title: '📊 Workflow Tabs & Views',
      content:
        "I've organized your workflows into tabs - All, Active, Completed, and Failed. You can also switch between grid and table views to see your workflows however you prefer.",
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.category-cards-container',
      position: 'center',
      title: '🗂️ Workflow Categories',
      content:
        "You can drag and drop workflows between categories to reorganize them. Click the collapse buttons to hide categories you don't need right now.",
      buttonText: 'Got It',
      highlightTarget: true,
      hideArrow: true,
      enforceStep: false,
    },
    {
      target: '.workflow-card',
      position: 'right',
      title: '📋 Workflow Cards',
      content:
        'Each workflow card shows its status, description, and the tools it uses. Click any card to see more details in the right panel, or double-click to edit it in the Workflow Designer.',
      buttonText: 'Makes Sense',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.workflows-panel',
      position: 'center',
      title: "✅ You're Ready!",
      content:
        "That's everything you need to know! Now you can create, organize, and manage your workflows like a pro. I'm here to help automate your tasks and make your life easier!",
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-WorkflowsScreen-completed', 'true');
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

  const initializeWorkflowsTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeWorkflowsTutorial,
  };
}
