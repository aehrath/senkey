// content.js – injected on demand when the user triggers autofill

(() => {
if (window.__senkeyInit) return;
window.__senkeyInit = true;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AUTOFILL') {
    sendResponse(autofill(msg.username, msg.password));
  }
});

function autofill(username, password) {
  // Find username / email fields
  const userSelectors = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[name*="account" i]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[id*="login" i]',
    'input[id*="account" i]',
    'input[type="text"]:not([readonly]):not([disabled])',
  ];

  const passSelectors = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
  ];

  let userField = null;
  for (const sel of userSelectors) {
    userField = document.querySelector(sel);
    if (userField) break;
  }

  let passField = null;
  for (const sel of passSelectors) {
    passField = document.querySelector(sel);
    if (passField) break;
  }

  if (!userField && !passField) {
    return { success: false, message: 'No login fields found on this page.' };
  }

  function fillInput(el, value) {
    el.focus();
    // Set value via native setter so React/Vue SPA forms detect the change
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  if (userField) fillInput(userField, username);
  if (passField) fillInput(passField, password);

  return {
    success: true,
    filledUser: !!userField,
    filledPass: !!passField,
  };
}
})();
