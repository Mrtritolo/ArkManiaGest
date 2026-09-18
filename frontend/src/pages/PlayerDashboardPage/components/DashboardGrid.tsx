/**
 * DashboardGrid -- every card of the dashboard, in one responsive grid.
 *
 * The grid is the same in both render modes: embedded used to be pinned to a
 * single column, which wasted the whole width of the admin content area on a
 * desktop. `.l-grid--cards` fills what it has and drops to one column on a
 * phone by itself.
 */
import type { DashboardResponse } from "../../../services/api";
import { CharacterHero } from "../cards/CharacterHero";
import { CharacterToolsCard } from "../cards/CharacterToolsCard";
import { DecayCard } from "../cards/DecayCard";
import { ActivityCard, RareDinosCard, TribeCard } from "../cards/FeedCards";
import { homeCards } from "../cards/HomesCards";
import { LeaderboardCard, ShopCard } from "../cards/ScoreCards";

export function DashboardGrid({ data, reloadToken, onChanged }: {
  data: DashboardResponse;
  reloadToken: number;
  onChanged: () => void;
}) {
  return (
    <div className="l-grid--cards">
      <div className="u-span-full">
        <CharacterHero character={data.character} presence={data.presence} />
      </div>

      <ShopCard data={data.shop} />
      <LeaderboardCard data={data.leaderboard} />
      <DecayCard data={data.decay} />
      <RareDinosCard data={data.rare_dinos} />
      <TribeCard data={data.tribe} />
      {/* One card per map the player has homes on -- spread into the grid
          rather than nested, so each map gets its own tile. */}
      {homeCards(data.homes, onChanged)}
      <CharacterToolsCard presence={data.presence} reloadToken={reloadToken} />
      <ActivityCard data={data.activity} />
    </div>
  );
}
