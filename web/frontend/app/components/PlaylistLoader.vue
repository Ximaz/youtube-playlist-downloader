<template>
  <div
    v-if="null === playlistMetadata"
    class="w-full flex items-center justify-center"
  >
    <Loader size="lg" />
  </div>
  <div v-else class="w-full flex flex-col items-center justify-evenly gap-4">
    <div class="w-full h-48 flex flex-col justify-evenly items-center">
      <ExportSettings
        :label="`Export playlist '${playlistMetadata.title}'`"
        @export="exportVideos"
        :loading="exportStarted"
      />
      <div
        v-if="exportStarted && totalProgress > 0"
        class="flex flex-col w-full justify-evenly items-center"
      >
        <p>Total Progression :</p>
        <UProgress class="max-w-[80vw]" :model-value="totalProgress" status />
      </div>
    </div>

    <VideoExportStatus
      v-for="video in playlistMetadata.videos"
      :key="video.videoId"
      ref="videos"
      :video="video"
      :steps="exportSteps"
      :force-refresh="forceRefresh"
      @progress="updateTotalProgressBar"
      @error="(e) => showError(e.name, e.message)"
    />
  </div>
  <ErrorModal
    :title="errorTitle"
    :description="errorDescription"
    :open="errorShow"
    @close="errorShow = false"
  />
</template>

<script setup lang="ts">
import Loader from "~/components/LoaderComponent.vue";
import VideoExportStatus from "~/components/VideoExportStatus.vue";
import type { GenericAPIResponse } from "~/models/GenericAPIResponse";
import type { WebsocketMessage } from "~/models/WebsocketMessage";
import ExportSettings from "~/components/ExportSettings.vue";
defineProps<{ forceRefresh: boolean }>();

const exportStarted = ref<boolean>(false);
const totalProgress = ref<number>(0);

const playlistMetadata = ref<RefinedPlaylistMetadata | null>(null);

const videos = ref<InstanceType<typeof VideoExportStatus>[]>([]);
const exportSteps = ref<string[]>([]);

const errorTitle = ref<string>("");
const errorDescription = ref<string>("");
const errorShow = ref<boolean>(false);

const compressionProgress = ref<number>(0);

function showError(title: string, description: string) {
  errorTitle.value = title;
  errorDescription.value = description;
  errorShow.value = true;
}

async function getPlaylistMetadata(playlistId: string, forceRefresh: boolean) {
  const response: GenericAPIResponse<RefinedPlaylistMetadata> = await $fetch(
    `/api/playlists/${playlistId}`,
    {
      query: { forceRefresh: forceRefresh ? "true" : "false" },
      headers: {
        Accept: "application/json",
      },
      onRequestError(context) {
        throw new Error(context.error?.message ?? "Unknown error occured");
      },
      onResponseError(context) {
        throw new Error(context.error?.message ?? "Unknown error occured");
      },
    }
  );

  return response.data!;
}

function updateTotalProgressBar() {
  const current = videos.value.reduce(
    (acc, { progress }) => acc + progress / 100,
    compressionProgress.value
  );
  const total = videos.value.length + 1;

  totalProgress.value = (current / total) * 100;
}

async function downloadExport(
  playlistName: string,
  {
    audio,
    video,
    convert,
  }: {
    audio: boolean;
    video: boolean;
    convert: boolean;
  }
) {
  const url = new URL("/api/videos/export", new URL(import.meta.url).origin);
  url.searchParams.append("audio", audio.toString());
  url.searchParams.append("video", video.toString());
  url.searchParams.append("convert", convert.toString());
  url.searchParams.append(
    "videoIds",
    playlistMetadata.value!.videos.map((video) => video.videoId).join(",")
  );

  const a = document.createElement("a");
  a.href = url.toString();
  a.download = `${playlistName}.zip`;
  a.click();
  exportStarted.value = false;
}

async function exportVideos({
  audio,
  video,
  convert,
  forceRefresh,
}: {
  audio: boolean;
  video: boolean;
  convert: boolean;
  forceRefresh: boolean;
}) {
  exportSteps.value = ["DOWNLOAD"];
  if (convert || (audio && video)) exportSteps.value.push("CONVERT");

  exportStarted.value = true;

  const response: GenericAPIResponse<{
    cachedVideos: string[];
    downloadJobIds: string[];
    compressJobId: string;
  }> = await $fetch("/api/videos/download", {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    body: {
      videoIds: playlistMetadata.value?.videos.map((video) => video.videoId),
      audio,
      video,
      convert,
      forceRefresh,
    },
    onRequestError(context) {
      throw new Error(context.error?.message ?? "Unknown error occured");
    },
    onResponseError(context) {
      throw new Error(context.error?.message ?? "Unknown error occured");
    },
  });

  response.data!.cachedVideos?.forEach((videoId) => {
    const video = videos.value.find((video) => video.videoId === videoId);
    video?.updateProgress(exportSteps.value.length);
  });

  if (0 === response.data!.downloadJobIds.length) {
    await downloadExport(playlistMetadata.value?.title ?? "playlist", {
      audio,
      video,
      convert,
    });
    return void 0;
  }

  const videoWebsocket = new WebSocket("/ws/jobs");

  videoWebsocket.onopen = () => {
    videoWebsocket.send(JSON.stringify(response.data!.downloadJobIds));
  };

  let closeCount = response.data!.cachedVideos.length ?? 0;
  videoWebsocket.onmessage = async (e: MessageEvent<string>) => {
    const msg = JSON.parse(e.data) as WebsocketMessage;

    switch (msg.type) {
      case "ERROR":
        console.error(msg.message);
        break;

      case "DOWNLOAD":
      case "CONVERT":
        videos.value
          .find((video) => video.videoId === msg.videoId)
          ?.updateProgress(msg.processed / msg.total, msg.type);
        break;

      case "CLOSE":
        ++closeCount;

        if (closeCount === playlistMetadata.value!.videos.length)
          await downloadExport(playlistMetadata.value?.title ?? "playlist", {
            audio,
            video,
            convert,
          });
      default:
        break;
    }
  };
  videoWebsocket.onerror = console.error;

  return response.data!;
}

async function loadPlaylist(playlistId: string, forceRefresh: boolean) {
  try {
    const response = await getPlaylistMetadata(playlistId, forceRefresh);
    playlistMetadata.value = response;
  } catch (e) {
    showError("Error", (e as Error).message);
    return void 0;
  }
}

defineExpose({
  loadPlaylist,
});
</script>
