## 2025-01-13 - [Added Disconnect Wallet Feature]
**Vulnerability:** Session Management Gap. Users had no way to clear sensitive API keys (stored in sessionStorage) without closing the browser tab, posing a risk in shared/public environments.
**Learning:** Even client-side-only apps need explicit session termination controls. Relying on "tab close" is insufficient for security hygiene.
**Prevention:** Always implement explicit "Logout" or "Disconnect" functionality that clears sensitive state and storage.
