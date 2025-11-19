export default defineEventHandler(async (event) => {
  const { id } = event.context.params!;
  const url = new URL(`/playlists/${id}`, process.env.BACKEND_API);
  const query = getQuery(event);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (query["forceRefresh"] === "true") {
    headers["X-Force-Refresh"] = "true";
  }

  const response = await fetch(url, {
    headers,
  });

  return await response.json();
});
