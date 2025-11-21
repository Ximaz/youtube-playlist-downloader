import { ref } from "vue";
import { defineStore } from "pinia";

export const useUserStore = defineStore(
  "user",
  () => {
    const token = ref<{ access_token: string }>({ access_token: "" });

    const setToken = (newToken: { access_token: string }) => {
      token.value = newToken;
    };

    return {
      token,
      setToken,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["token"],
    },
  }
);
