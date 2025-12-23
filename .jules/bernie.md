## 2024-12-23 - [The Forge]
**Observation:** `useForge` hook was dynamically injecting a script tag (`forge.min.js`) into the body and blocking the entire app render until it loaded. This created a "Loading Security Libraries..." screen for no good reason.
**Lesson:** Use standard HTML `<script>` tags for external libraries. React doesn't need to manage everything. The browser is good at loading scripts.
