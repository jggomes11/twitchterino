'use strict';

// Static, credential-free UI action; callers supply the fixed official page URL.
function chestClickScript(expectedUrl, timeoutMs = 40000) {
  const url = new URL(expectedUrl);
  const settings = { origin: url.origin, pathname: url.pathname.replace(/\/$/, ''), timeoutMs: Math.min(40000, Math.max(500, timeoutMs)) };
  const clickBonus = ({ origin, pathname, timeoutMs }) => new Promise(resolve => {
    const started = Date.now(); let seen = false;
    const timer = setInterval(() => {
      if (location.origin !== origin || location.pathname.replace(/\/$/, '') !== pathname) {
        clearInterval(timer); resolve({ clicked: false, reason: 'unexpected-page' }); return;
      }
      const icon = document.querySelector('.claimable-bonus__icon');
      const button = icon && icon.closest('button');
      if (button) seen = true;
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        && !String(button.className).includes('ScCoreButtonDestructive')) {
        clearInterval(timer); button.click(); resolve({ clicked: true }); return;
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer); resolve({ clicked: false, reason: seen ? 'bonus-button-unavailable' : 'bonus-button-not-found' });
      }
    }, 500);
  });
  return '(' + clickBonus.toString() + ')(' + JSON.stringify(settings) + ')';
}

module.exports = { chestClickScript };
