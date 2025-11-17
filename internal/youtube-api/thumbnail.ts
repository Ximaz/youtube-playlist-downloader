export function getBestThumbnailUrl(
  thumbnails: { url: string; width: number; height: number }[],
) {
  return (
    thumbnails
      .sort((t1, t2) => t1.width * t1.height - t2.width * t2.height)
      .at(-1)?.url ?? "#"
  );
}
