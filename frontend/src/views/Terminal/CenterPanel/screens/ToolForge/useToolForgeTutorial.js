import { ref } from 'vue';

export function useToolForgeTutorial() {
  const tutorialConfig = ref([
    {
      target: '.tool-forge-center-panel',
      position: 'center',
      title: '🔧 Welcome to Tool Forge!',
      content:
        'This is where I help you create custom tools! You can build powerful tools that extend my capabilities and use them in workflows or let me use them directly in chat.',
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: 'tool-menu',
      position: 'bottom',
      title: '📋 Tool Selection & Actions',
      content: 'Use this menu to select existing tools or create new ones. You can also save, delete, and manage your tool templates from here!',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.info-card',
      position: 'bottom',
      title: '✨ Tool Information',
      content:
        'Give your tool a name, choose its type (AI, JavaScript, or Python), and select an icon. For AI tools, you can also pick which AI provider and model to use!',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.code-card',
      position: 'bottom',
      title: '📝 Instructions or Code',
      content:
        'For AI tools, write instructions that tell me what to do. For JavaScript or Python tools, write the code that will execute. This is the heart of your tool!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.parameters-card',
      position: 'top',
      title: '⬇️ Input Parameters',
      content:
        'Define what inputs your tool needs! Add custom fields for users to fill in when they use your tool. You can create text fields, dropdowns, file uploads, and more!',
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.output-fields-list',
      position: 'top',
      title: '⬆️ Output Parameters',
      content:
        'Specify what your tool returns! Define output parameters so users know what data to expect. You can add custom outputs beyond the default ones!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.bottom-actions',
      position: 'top',
      title: '🧪 Test Your Tool',
      content:
        "Once your tool is saved, click 'Run Tool' to test it! I'll execute your tool and show you the results in real-time. This helps you catch any issues and make sure everything works perfectly.",
      buttonText: "Let's Create!",
      highlightTarget: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-toolForge-completed', 'true');
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

  const initializeToolForgeTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeToolForgeTutorial,
  };
}
