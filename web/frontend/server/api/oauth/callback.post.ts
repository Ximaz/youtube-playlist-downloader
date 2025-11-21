export default defineEventHandler(async (event) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (undefined === googleClientId || undefined === googleClientSecret) {
    throw createError("Feature not supported");
  }

  const contentType = getHeader(event, "Content-Type");
  if (contentType !== "application/json") {
    throw createError("Invalid content-type header");
  }
  const base = getRequestURL(event).origin;

  const url = new URL("/o/oauth2/token", "https://accounts.google.com");
  const callbackUrl = `${base}/oauth/callback`;

  const { code } = await readBody(event);
  const finalCode = typeof code === "string" ? code : (code! as string[])[0];
  const data = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    code: finalCode,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl,
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    body: data,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw createError(response);
  }

  const token = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_at: number;
  };

  return token;
});
