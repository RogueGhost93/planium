/**
 * Modul: Service Worker Registrierung
 * Zweck: Ausgelagert aus index.html um CSP-Inline-Script-Verletzung zu vermeiden
 * Abhängigkeiten: keine
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] Registrierung fehlgeschlagen:', err);
    });
  });
}
