'use strict';

(function publish(root) {
  function create({ container, onSelect, onConnect, onDisconnect, onError }) {
    const cards = new Map();
    const pending = new Map();
    let accounts = [], selectedId, openId;
    function closeMenu(restoreFocus = false) {
      const card = cards.get(openId);
      if (card) {
        card.menu.hidden = true;
        card.settings.setAttribute('aria-expanded', 'false');
        if (restoreFocus) card.settings.focus();
      }
      openId = null;
    }
    function openMenu(id) {
      const card = cards.get(id);
      if (!card || card.settings.hidden || card.settings.disabled) return;
      closeMenu();
      openId = id;
      card.menu.hidden = false;
      card.settings.setAttribute('aria-expanded', 'true');
      card.disconnect.focus();
    }
    async function run(id, action, callback) {
      if (pending.has(id)) return;
      const hadFocus = cards.get(id)?.card.contains(document.activeElement);
      closeMenu();
      pending.set(id, action);
      render(accounts, selectedId);
      try { await callback(id); }
      catch (error) { onError(error); }
      finally {
        pending.delete(id); render(accounts, selectedId);
        const card = cards.get(id);
        if (hadFocus && card && (document.activeElement === document.body || card.menu.contains(document.activeElement))) card.select.focus();
      }
    }
    function makeCard(id) {
      const card = document.createElement('div');
      card.className = 'account-card'; card.dataset.accountId = id;
      const select = document.createElement('button');
      select.type = 'button'; select.className = 'account-tab';
      const name = document.createElement('b'), detail = document.createElement('small');
      select.append(name, detail);
      const settings = document.createElement('button');
      settings.type = 'button'; settings.className = 'account-settings icon'; settings.textContent = '⚙';
      settings.setAttribute('aria-haspopup', 'menu'); settings.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');
      menu.className = 'account-menu'; menu.id = `account-menu-${id}`; menu.hidden = true;
      menu.setAttribute('role', 'menu'); settings.setAttribute('aria-controls', menu.id);
      const disconnect = document.createElement('button');
      disconnect.type = 'button'; disconnect.className = 'account-disconnect'; disconnect.textContent = 'Desconectar';
      disconnect.setAttribute('role', 'menuitem'); menu.append(disconnect);
      card.append(select, settings, menu); container.append(card);
      const entry = { card, select, name, detail, settings, menu, disconnect };
      select.onclick = () => {
        closeMenu();
        if (entry.account.loggedIn) Promise.resolve(onSelect(id)).catch(onError);
        else run(id, 'connect', onConnect);
      };
      settings.onclick = () => openId === id ? closeMenu() : openMenu(id);
      settings.onkeydown = event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(id); }
      };
      menu.onkeydown = event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); disconnect.focus(); }
      };
      disconnect.onclick = () => run(id, 'disconnect', onDisconnect);
      return entry;
    }
    function render(next, activeId) {
      accounts = next; selectedId = activeId;
      for (const account of accounts) {
        let card = cards.get(account.id);
        if (!card) { card = makeCard(account.id); cards.set(account.id, card); }
        card.account = account;
        const checking = !!account.sessionChecking;
        const connected = !!account.loggedIn;
        const busy = pending.get(account.id);
        card.card.classList.toggle('active', account.id === selectedId);
        card.select.setAttribute('aria-pressed', String(account.id === selectedId));
        card.select.disabled = checking || !!busy;
        card.name.textContent = connected || checking ? account.username || account.label : 'Adicionar conta';
        card.detail.textContent = busy === 'disconnect' ? 'Desconectando…' : busy === 'connect' ? 'Conectando…'
          : checking ? 'Verificando sessão…' : connected ? account.detail : account.label;
        card.select.title = `${account.label}${connected && account.username ? ': ' + account.username : ''} — ${card.detail.textContent}`;
        card.settings.hidden = !connected || checking;
        card.settings.disabled = !!busy;
        card.disconnect.disabled = !!busy;
        card.settings.title = `Configurações de ${account.username || account.label}`;
        card.settings.setAttribute('aria-label', card.settings.title);
        card.menu.setAttribute('aria-label', card.settings.title);
        if (card.settings.hidden && openId === account.id) closeMenu();
      }
      for (const [id, card] of cards) {
        if (!accounts.some(account => account.id === id)) {
          if (openId === id) closeMenu();
          card.card.remove(); cards.delete(id);
        }
      }
    }
    document.addEventListener('click', event => {
      if (openId && !cards.get(openId).card.contains(event.target)) closeMenu();
    }, true);
    document.addEventListener('focusin', event => {
      if (openId && !cards.get(openId).card.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && openId) { event.preventDefault(); closeMenu(true); }
    });
    return { render, closeMenu };
  }
  root.AccountCards = Object.freeze({ create });
})(globalThis);
