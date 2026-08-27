import { ListenApp } from "./listen-app";

export const metadata = { title: "Lyssna – Usha Platform" };

export default function LyssnaPage() {
  // Hela vyn bor i webbläsaren: dokumenten ligger i localStorage och
  // uppläsningen sker i webbläsarens talsyntes. Servern har inget att hämta.
  return <ListenApp />;
}
