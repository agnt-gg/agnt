// Track timeouts for cleanup
const activeTimeouts = new Set();

function createConfetti(parent, count = 18) {
  for (let i = 0; i < count; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    const angle = Math.random() * 2 * Math.PI;
    const distance = 40 + Math.random() * 40;
    confetti.style.left = '50%';
    confetti.style.top = '50%';
    confetti.style.transform = `translate(-50%, -50%) translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px) rotate(${
      Math.random() * 360
    }deg)`;
    confetti.style.transition = 'opacity 1.2s, transform 1.2s';
    const timeout1 = setTimeout(() => {
      confetti.style.opacity = 0;
      confetti.style.transform += ' scale(1.3)';
      activeTimeouts.delete(timeout1);
    }, 100);
    activeTimeouts.add(timeout1);
    parent.appendChild(confetti);
    const timeout2 = setTimeout(() => {
      confetti.remove();
      activeTimeouts.delete(timeout2);
    }, 1400);
    activeTimeouts.add(timeout2);
  }
}

function createStars(parent, count = 6) {
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.innerHTML = '★';
    const angle = Math.random() * 2 * Math.PI;
    const distance = 24 + Math.random() * 24;
    const xOffset = 0;
    star.style.left = '50%';
    star.style.top = '50%';
    star.style.transform = `translate(calc(-50% + ${xOffset}px), -50%) translate(${Math.cos(angle) * distance}px, ${
      Math.sin(angle) * distance
    }px) scale(${1 + Math.random() * 0.7})`;
    star.style.transition = 'opacity 1.2s, transform 1.2s';
    const timeout1 = setTimeout(() => {
      star.style.opacity = 0;
      star.style.transform += ' scale(1.3)';
      activeTimeouts.delete(timeout1);
    }, 100);
    activeTimeouts.add(timeout1);
    parent.appendChild(star);
    const timeout2 = setTimeout(() => {
      star.remove();
      activeTimeouts.delete(timeout2);
    }, 1400);
    activeTimeouts.add(timeout2);
  }
}

export function showNotification(message) {
  const container = document.getElementById('notification-popup');
  if (!container) return;
  // Remove any existing notification immediately
  const existing = container.querySelector('.notification');
  if (existing) existing.remove();
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = message;
  container.appendChild(notif);
  createConfetti(notif);
  // createStars(notif);
  const timeout1 = setTimeout(() => {
    notif.style.opacity = 0;
    notif.style.transform = 'translateY(-30px)';
    activeTimeouts.delete(timeout1);
    const timeout2 = setTimeout(() => {
      notif.remove();
      activeTimeouts.delete(timeout2);
    }, 500);
    activeTimeouts.add(timeout2);
  }, 2200);
  activeTimeouts.add(timeout1);
}

/**
 * Clean up all active timeouts
 * Call this when the game/component is unmounted
 */
export function cleanupNotifications() {
  activeTimeouts.forEach((timeoutId) => {
    clearTimeout(timeoutId);
  });
  activeTimeouts.clear();
}
