<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>

<script setup lang="ts">
import { useUserStore } from "~/stores/userStore";

const route = useRoute();

const router = useRouter();

const userStore = useUserStore();

onMounted(async () => {
  const body = JSON.stringify(route.query);

  const response = await $fetch<{ access_token: string }>(
    "/api/oauth/callback",
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  userStore.setToken(response);

  router.push("/");
});
</script>
