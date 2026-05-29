import { Module } from '@nestjs/common';

import { WorkStore } from './work-store.service';

// Explicit-imports only — both the download pipeline and the realtime gateway depend on
// WorkStore, but the graph is acyclic (RealtimeModule does not import DownloadModule), so
// the @Global() shortcut hid a dependency that should be declared explicitly.
@Module({
  providers: [WorkStore],
  exports: [WorkStore],
})
export class BatchModule {}
