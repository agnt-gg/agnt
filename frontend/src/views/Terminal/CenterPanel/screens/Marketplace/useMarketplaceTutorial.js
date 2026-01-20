import { ref } from 'vue';

export function useMarketplaceTutorial() {
  const tutorialConfig = ref([
    {
      target: '.marketplace-panel',
      position: 'center',
      title: '🛒 Welcome to the Marketplace!',
      content:
        'This is where you can discover and install workflows, agents, and tools created by the community. You can also publish your own creations and earn from them!',
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '.sticky-header',
      position: 'bottom',
      title: '📑 Browse & Filter',
      content:
        "I've organized the marketplace into tabs - browse All items, or filter by Workflows, Agents, and Tools. You can also view your installed items, published listings, and earnings.",
      buttonText: 'Next',
      highlightTarget: true,
    },
    {
      target: '.controls-bar',
      position: 'bottom',
      title: '🔍 Search & Discover',
      content:
        'Use the search bar to find specific items, and filter by categories to narrow down your results. I make it easy to find exactly what you need!',
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.category-cards-container',
      position: 'center',
      title: '🎯 Marketplace Items',
      content:
        'Each item shows its price, ratings, downloads, and publisher. Click any item to see full details, or click the install button to add it to your collection!',
      buttonText: 'Makes Sense',
      highlightTarget: true,
      hideArrow: true,
      enforceStep: false,
    },
    {
      target: '.marketplace-panel',
      position: 'center',
      title: "✅ You're Ready to Explore!",
      content:
        'Now you can browse the marketplace, install amazing workflows and tools, and even publish your own creations to earn. Happy exploring!',
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-MarketplaceScreen-completed', 'true');
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

  const initializeMarketplaceTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeMarketplaceTutorial,
  };
}
