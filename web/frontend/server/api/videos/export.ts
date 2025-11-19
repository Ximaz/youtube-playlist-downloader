export default defineEventHandler(async (event) => {
  const url = new URL(`/videos/export`, process.env.BACKEND_API);

  const body = getQuery<{
    videoIds: string;
    audio?: string;
    video?: string;
    convert?: string;
  }>(event);

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({
      videoIds: body.videoIds.split(","),
      audio: body.audio === "true",
      video: body.video === "true",
      convert: body.convert === "true",
    }),
  });

  const res = event.node.res;

  if (response.body) {
    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    await pump();
  }
});
