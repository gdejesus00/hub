// Putting the app on a home screen. A browser that can install the app hands the page an
// "install box" it may open once, after a tap. This file only decides what to show; app.js holds
// the box and does the tapping.

// Where the app stands on this device:
//   installed  it is running as the installed app
//   ready      the browser offered an install box, so one tap installs it
//   likely     it was installed from this browser before and no box is on offer, so it is
//              most likely still on the home screen
//   manual     no box on offer (the browser has none, or has not offered yet): show the menu steps
export function installState({ standalone = false, prompt = false, installedBefore = false } = {}) {
  if (standalone) return 'installed';
  if (prompt) return 'ready';
  return installedBefore ? 'likely' : 'manual';
}

// The Install button on Today shows only in a browser tab, and only until it is hidden.
export const showOnToday = (status, hidden = false) => !hidden && (status === 'ready' || status === 'manual');

// The same thing by hand, for when there is no install box to open.
export function manualSteps(agent = '') {
  if (/iphone|ipad|ipod/i.test(agent)) {
    return ['Open this page in Safari.', 'Tap the Share button.', 'Tap "Add to Home Screen", then "Add".'];
  }
  if (/android/i.test(agent)) {
    return ['Tap the three dots at the top right of Chrome.', 'Tap "Add to Home screen".', 'Tap "Install".'];
  }
  return ['Open the browser menu, or look for an install icon in the address bar.', 'Choose "Install" (or "Add to Home screen").'];
}

export const STATUS_LINE = {
  installed: 'Installed. You are using the installed app.',
  ready: 'Ready to install on this device.',
  likely: 'Installed from this browser. Open it from your home screen.',
  manual: 'Not installed. Use the steps below.',
};
