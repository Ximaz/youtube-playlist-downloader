export default defineEventHandler(async (event) => {
  const base = getRequestURL(event).origin;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (undefined === googleClientId) {
    return null;
  }
  const url = new URL("/o/oauth2/auth", "https://accounts.google.com");
  const callbackUrl = `${base}/oauth/callback`;

  url.searchParams.append("client_id", googleClientId!);
  url.searchParams.append("redirect_uri", callbackUrl);
  url.searchParams.append(
    "scope",
    "https://www.googleapis.com/auth/youtube.readonly",
  );
  url.searchParams.append("response_type", "code");
  url.searchParams.append("access_type", "offline");
  url.searchParams.append("prompt", "consent");

  return url.toString();
});
