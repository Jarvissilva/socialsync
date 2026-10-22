import supertest from "supertest";
import type { Express } from "express";

export async function inject(
  app: Express,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const agent = supertest(app);
  const request =
    method === "POST"
      ? agent.post(url)
      : method === "PUT"
        ? agent.put(url)
        : method === "DELETE"
          ? agent.delete(url)
          : agent.get(url);
  request.set("Host", "127.0.0.1:3002");
  for (const [key, value] of Object.entries(options.headers || {}))
    request.set(key, value);
  if (options.body !== undefined)
    request
      .set("Content-Type", "application/json")
      .send(JSON.stringify(options.body));
  const response = await request.timeout(5000);
  return {
    status: response.status,
    body: response.text,
    headers: response.headers,
  };
}
