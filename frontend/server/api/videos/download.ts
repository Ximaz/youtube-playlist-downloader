export default defineEventHandler(async (event) => {
  const url = new URL(`/videos/download`, process.env.BACKEND_API);

  const body = await readBody<{
    videoIds: string[];
    audio?: boolean;
    video?: boolean;
    convert?: boolean;
    forceRefresh?: boolean;
  }>(event);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(body),
  });

  return await response.json();
});
