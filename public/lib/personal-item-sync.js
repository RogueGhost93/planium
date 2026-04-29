const PERSONAL_ITEM_SYNC_EVENT = 'planium:personal-item-sync';
const PERSONAL_ITEM_SYNC_KEY = 'planium-personal-item-sync';

export function broadcastPersonalItemChange(detail) {
  const payload = {
    ...detail,
    ts: Date.now(),
  };

  try {
    localStorage.setItem(PERSONAL_ITEM_SYNC_KEY, JSON.stringify(payload));
  } catch (_) {}

  window.dispatchEvent(new CustomEvent(PERSONAL_ITEM_SYNC_EVENT, { detail: payload }));
  return payload;
}

export function subscribePersonalItemChange(handler) {
  const onCustomEvent = (event) => handler(event.detail);
  const onStorageEvent = (event) => {
    if (event.key !== PERSONAL_ITEM_SYNC_KEY || !event.newValue) return;
    try {
      handler(JSON.parse(event.newValue));
    } catch (_) {}
  };

  window.addEventListener(PERSONAL_ITEM_SYNC_EVENT, onCustomEvent);
  window.addEventListener('storage', onStorageEvent);

  return () => {
    window.removeEventListener(PERSONAL_ITEM_SYNC_EVENT, onCustomEvent);
    window.removeEventListener('storage', onStorageEvent);
  };
}
