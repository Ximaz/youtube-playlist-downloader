<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
} from 'naive-ui';

import AppShell from './components/AppShell.vue';
import { themeOverrides } from './lib/theme';
</script>

<template>
  <!-- :theme="null" = Naive's default light theme. The four child providers must wrap
       AppShell so any descendant can call useMessage/useDialog/useNotification/useLoadingBar
       (they look up the provider via Vue's inject chain). -->
  <n-config-provider :theme="null" :theme-overrides="themeOverrides">
    <n-loading-bar-provider>
      <n-message-provider>
        <n-dialog-provider>
          <n-notification-provider>
            <AppShell />
          </n-notification-provider>
        </n-dialog-provider>
      </n-message-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>
