import { ref } from 'vue';

export function useSettingsTutorial() {
  const tutorialConfig = ref([
    {
      target: '.settings-content',
      position: 'center',
      title: '⚙️ Welcome to Settings!',
      content: "This is your control center for customizing AGNT. I'll show you around the navigation options so you can find everything you need!",
      buttonText: 'Show Me Around',
      hideArrow: true,
    },
    {
      target: '[data-nav="profile"]',
      position: 'right',
      title: '👤 Profile',
      content:
        'View your account details and $AGNT Network Score. This score reflects your activity, referrals, and contributions to the AGNT ecosystem!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="leaderboard"]',
      position: 'right',
      title: '🏅 Leaderboard',
      content:
        'Check the Leaderboard to see how you rank against other users based on Referral Score and $AGNT Network Score. Compete and climb the ranks!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="referrals"]',
      position: 'right',
      title: '🤝 Referrals',
      content: 'Invite friends and earn credits! Share your unique referral link and track your referral tree and earnings.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="billing"]',
      position: 'right',
      title: '💳 Billing',
      content: 'Manage your subscription, view usage, and purchase credits. Keep track of your spending and credit balance here.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="api-keys"]',
      position: 'right',
      title: '🔑 API Keys',
      content:
        'Generate and manage API keys for programmatic access to AGNT. This is a PRO feature that lets you integrate AGNT with your own applications!',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-section="configuration"]',
      position: 'bottom',
      title: '📋 Configuration Section',
      content:
        "The navigation panel groups settings into sections. Let's explore the Configuration options where you can customize your AGNT experience!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="theme"]',
      position: 'right',
      title: '🎨 Theme Settings',
      content: 'Customize your visual experience! Choose from different themes to make AGNT look exactly how you want. This is a PRO feature.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="sounds"]',
      position: 'right',
      title: '🔊 Sound Settings',
      content: 'Control audio feedback and sound effects. Enable or disable sounds, adjust volume, and customize your audio experience.',
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="tours"]',
      position: 'right',
      title: '🗺️ Tours & Tutorials',
      content:
        "Manage interactive tours and tutorials here. You can restart any tour, reset tutorial progress, or disable tours if you're already familiar with AGNT!",
      buttonText: 'Next',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '[data-nav="general"]',
      position: 'right',
      title: '🚪 Logout',
      content: 'When you need to sign out, use this option to safely logout from your AGNT account.',
      buttonText: 'Got It',
      highlightTarget: true,
      enforceStep: false,
    },
    {
      target: '.settings-content',
      position: 'center',
      title: '💡 Pro Tips',
      content:
        'Remember: Click any navigation item to view that section. Your Profile shows your $AGNT score, Referrals help you earn credits, and Tours lets you replay any tutorial!',
      buttonText: 'Next',
      hideArrow: true,
    },
    {
      target: '.settings-content',
      position: 'center',
      title: "✅ You're All Set!",
      content:
        "Now you know how to navigate your settings. Click any section in the left panel to explore and customize AGNT. I'm here if you need help!",
      buttonText: "Let's Go!",
      hideArrow: true,
    },
  ]);

  const startTutorial = ref(false);
  const currentStep = ref(0);

  const onTutorialClose = () => {
    startTutorial.value = false;
    currentStep.value = 0;
    localStorage.setItem('tutorial-SettingsScreen-completed', 'true');
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

  const initializeSettingsTutorial = () => {
    currentStep.value = 0;
    startTutorial.value = true;
  };

  return {
    tutorialConfig,
    startTutorial,
    currentStep,
    onTutorialClose,
    nextStep,
    initializeSettingsTutorial,
  };
}
