<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div class="app-shell__brand">
        <span class="app-shell__logo">TON Bot Control</span>
        <p class="app-shell__subtitle">Go backend · Vue dashboard</p>
      </div>
      <nav class="app-shell__nav">
        <router-link to="/">Панель</router-link>
      </nav>
    </header>
    <main class="app-shell__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  background: #0f1116;
  color: #f2f5f7;
}

.app-shell__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #1e2330;
  background: rgba(15, 17, 22, 0.95);
  backdrop-filter: blur(12px);
}

.app-shell__brand {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.app-shell__logo {
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.app-shell__subtitle {
  margin: 0;
  color: #9ba6bd;
  font-size: 0.9rem;
}

.app-shell__nav a {
  color: #d4e1ff;
  text-decoration: none;
  font-weight: 500;
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  transition: background 0.2s ease;
}

.app-shell__nav a:hover,
.app-shell__nav a.router-link-active {
  background: rgba(116, 130, 255, 0.18);
}

.app-shell__main {
  flex: 1;
  padding: 2rem;
}

@media (max-width: 720px) {
  .app-shell__header {
    flex-direction: column;
    gap: 1rem;
  }

  .app-shell__main {
    padding: 1.25rem;
  }
}
</style>
