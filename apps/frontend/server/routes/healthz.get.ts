// Liveness/readiness for the Nuxt BFF tier. Dependency-free: the Nitro process being able to
// answer is the signal. Wired to the K8s liveness/readiness probes and the compose healthcheck.
export default defineEventHandler(() => ({ status: 'ok', service: 'frontend' }));
