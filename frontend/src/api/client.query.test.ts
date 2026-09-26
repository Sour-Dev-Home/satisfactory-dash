import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type HistoryRange } from "@satisfactory-dash/shared";
import { alertEventsLastPage, historyPower24h } from "@satisfactory-dash/shared/fixtures";
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

  it("leaves an optional parameter that is undefined out of the URL (the alert log's first page)", async () => {
    const urls: string[] = [];
    server.use(
      http.get(endpoints.alerts.events.route, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(alertEventsLastPage);
      }),
    );
    await apiGetQuery(signal(), endpoints.alerts.events, { limit: 50, before: undefined }, "default");
    await apiGetQuery(signal(), endpoints.alerts.events, { limit: 50, before: "408" }, "default");
    expect(urls.map((u) => new URL(u).search)).toEqual(["?limit=50", "?limit=50&before=408"]);
  });
});
