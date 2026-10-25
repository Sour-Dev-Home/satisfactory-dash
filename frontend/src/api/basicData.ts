import { useQuery } from "@tanstack/react-query";
import { useSettledQuery } from "./settled";
import { useSelectedServer } from "../servers/ServerContext";
import { ApiError } from "./errors";
import { queries } from "./queries";

const isUnreachable = (error: unknown): boolean => error instanceof ApiError && error.code === "upstream_unreachable";

/**
 * ADR-0057 Decision 2 step 1: a server that gives only the game's own API data (no power, no factory). There is no
 * field for it in the contract; it is read from what the existing reads already say: the game answers (a live status),
 * it has no player list (the vanilla API only counts players), and neither power nor factory was ever served. A
 * server whose power or factory once arrived keeps serving it (stale), so it is never taken for a basic one.
 * Same query keys as the pages, so this adds no request.
 */
export function useBasicData(): boolean {
  const server = useSelectedServer();
  const status = useQuery(queries.status(server.id));
  const players = useQuery(queries.players(server.id));
  const power = useSettledQuery(queries.power(server.id));
  const factory = useSettledQuery(queries.factory(server.id));
  return (
    status.data !== undefined &&
    status.data.unreachableSince === undefined &&
    players.data?.available === false &&
    power.query.data === undefined &&
    factory.query.data === undefined &&
    isUnreachable(power.error) &&
    isUnreachable(factory.error)
  );
}
