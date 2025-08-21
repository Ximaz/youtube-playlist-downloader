declare interface RefinedVideoMetadata extends Record<string, string> {
  videoId: string;
  author: string;
  title: string;
  date: string;
  description: string;
  thumbnailUrl: string;
}
