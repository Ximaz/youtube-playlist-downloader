declare interface RefinedPlaylistMetadata {
  playlistId: string;
  title: string;
  videos: {
    title: string;
    author: string;
    videoId: string;
    thumbnailUrl: string;
  }[];
  thumbnailUrl: string;
}
