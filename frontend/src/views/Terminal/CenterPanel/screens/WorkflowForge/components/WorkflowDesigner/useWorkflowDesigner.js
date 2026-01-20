import { useTutorial } from './useTutorial';

export default function useWorkflowDesigner() {
  const { tutorialConfig, startTutorial, onTutorialClose } = useTutorial();

  const initializeWorkflowDesigner = () => {
    // Delay the start of the tutorial to ensure components are mounted
    setTimeout(() => {
      startTutorial.value = true;
    }, 2000); // Adjust this delay as needed
  };

  return {
    tutorialConfig,
    startTutorial,
    onTutorialClose,
    initializeWorkflowDesigner,
  };
}
