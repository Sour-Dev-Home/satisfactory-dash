import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type HistoryRange } from "@satisfactory-dash/shared";
import { historyPower24h } from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { apiGetQuery } from "./client";
import { RequestValidationError } from "./errors";

const signal = () => new AbortController().signal;

describe("apiGetQuery", () => {
  it("sends the query string and parses the body", async () => {
    let url = "";
    server.use(
      http.get(endpoints.history.power.route, ({ request }) => {
        url = request.url;
        return HttpResponse.json(historyPower24h);
      }),
    );
    const body = await apiGetQuery(signal(), endpoints.history.power, { range: "7d" }, "my server");
    expect(new URL(url).pathname).toBe("/api/servers/my%20server/history/power");
    expect(new URL(url).searchParams.get("range")).toBe("7d");
    expect(body.data.range).toBe("24h");
  });

  it("rejects a value the endpoint's query schema refuses, without sending anything", async () => {
    let sent = false;
    server.use(
      http.get(endpoints.history.power.route, () => {
        sent = true;
        return HttpResponse.json(historyPower24h);
      }),
    );
    await expect(
      apiGetQuery(signal(), endpoints.history.power, { range: "2w" as HistoryRange }, "default"),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(sent).toBe(false);
  });
});
