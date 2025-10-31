declare interface RefinedPlaylistMetadata {
  playlistId: string;
  title: string;
  videos: { title: string; author: string; id: string; thumbnail: string }[];
  thumbnailUrl: string;
}
