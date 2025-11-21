import { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "Authorization");

  if (undefined === authorization || !authorization.startsWith("Bearer ")) {
    return createError("Invalid bearer token");
  }

  const url = new URL("/youtube/v3/playlists", "https://www.googleapis.com");
  url.searchParams.append("part", "snippet");
  url.searchParams.append("maxResults", "50");
  url.searchParams.append("mine", "true");

  const response = await fetch(url, {
    headers: {
      Authorization: authorization,
    },
  });

  return (await response.json()) satisfies YoutubeAPIPlaylistsResponse;
});
