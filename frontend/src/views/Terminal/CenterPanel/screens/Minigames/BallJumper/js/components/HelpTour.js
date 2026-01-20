// Simple in-game help tour overlay
const helpSteps = [
  {
    title: 'How to Play',
    content: 'Bounce as high as you can! Land on platforms to gain height and XP. Set new height records and unlock special moves.'
  },
  {
    title: 'Controls',
    content: 'Move Left: ←/A\nMove Right: →/D\nJump: Space/↑/W\nUp-Dash (after 50 XP): Double-tap ↑ or W'
  },
  {
    title: 'Gameplay',
    content: 'Jump onto platforms, earn XP, and climb higher. Use Up-Dash for a powerful boost (costs 60 XP per second of use).'
  },
  {
    title: 'Tips',
    content: 'Land carefully on slanted platforms. Save XP for tricky jumps. Watch for notifications and set new records!'
  }
];

let overlay = null;
let currentStep = 0;

function renderStep(stepIdx) {
  if (!overlay) return;
  const step = helpSteps[stepIdx];
  overlay.innerHTML = `
    <div class="help-tour-modal">
      <h2>${step.title}</h2>
      <pre>${step.content}</pre>
      <div class="help-tour-nav">
        <button id="help-prev" ${stepIdx === 0 ? 'disabled' : ''}>Back</button>
        <button id="help-next" ${stepIdx === helpSteps.length - 1 ? 'disabled' : ''}>Next</button>
        <button id="help-close">Close</button>
      </div>
    </div>
  `;
  overlay.querySelector('#help-prev').onclick = () => {
    if (currentStep > 0) {
      currentStep--;
      renderStep(currentStep);
    }
  };
  overlay.querySelector('#help-next').onclick = () => {
    if (currentStep < helpSteps.length - 1) {
      currentStep++;
      renderStep(currentStep);
    }
  };
  overlay.querySelector('#help-close').onclick = hideHelpTour;
}

export function showHelpTour() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'help-tour-overlay';
  document.body.appendChild(overlay);
  currentStep = 0;
  renderStep(currentStep);
}

export function hideHelpTour() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
} 