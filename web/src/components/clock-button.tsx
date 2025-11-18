import { useState } from "hono/jsx";
import type { AppType } from "..";
import type { hc } from "hono/client";

export const ClockButton = ({ client } : { client: ReturnType<typeof hc<AppType>>}) => {
  const [response, setResponse] = useState<string | null>(null);

  const handleClick = async () => {
    const response = await client.api.clock.$get();
    const data = await response.json();
    const headers = Array.from(response.headers.entries()).reduce<
      Record<string, string>
    >((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
    const fullResponse = {
      url: response.url,
      status: response.status,
      headers,
      body: data,
    };
    setResponse(JSON.stringify(fullResponse, null, 2));
  };

  return (
    <div>
      <button type="button" onClick={handleClick}>
        Get Server Time
      </button>
      {response && <pre>{response}</pre>}
    </div>
  );
};
