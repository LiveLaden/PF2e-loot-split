/**
 * Loot Split — shared helpers (no Foundry imports, safe for all clients).
 */

/** Item types that can appear as loot lots (fallback when isOfType is unavailable). */
export const PHYSICAL_TYPES = new Set([
  "weapon", "armor", "shield", "equipment", "consumable",
  "treasure", "backpack", "kit", "ammo", "book",
]);

/** True for real PCs: character type, no minion/eidolon traits. Excludes familiars, summons, NPCs. */
export function isPcActor(actor) {
  if (!actor) return false;
  if (actor.type !== "character") return false;
  const traits = actor.system?.traits?.value ?? [];
  if (Array.isArray(traits) && (traits.includes("minion") || traits.includes("eidolon"))) return false;
  return true;
}

/** Normalize a party.members entry (Actor or {actor} wrapper) to an Actor. */
export function memberToActor(entry) {
  if (!entry) return null;
  if (entry.documentName === "Actor") return entry;
  if (entry.actor?.documentName === "Actor") return entry.actor;
  return null;
}

/** Price data ({pp,gp,sp,cp} or Coins-like with copperValue) -> gold pieces per unit. */
export function priceToGp(priceValue) {
  if (!priceValue) return 0;
  if (typeof priceValue.copperValue === "number") return priceValue.copperValue / 100;
  const pp = Number(priceValue.pp ?? 0);
  const gp = Number(priceValue.gp ?? 0);
  const sp = Number(priceValue.sp ?? 0);
  const cp = Number(priceValue.cp ?? 0);
  return pp * 10 + gp + sp / 10 + cp / 100;
}

/** Full lot value in gp: (unit price / per) * quantity. */
export function itemLotValueGp(item) {
  try {
    const qty = Math.max(1, Number(item.system?.quantity ?? 1));
    const per = Math.max(1, Number(item.system?.price?.per ?? 1));
    return (priceToGp(item.system?.price?.value) / per) * qty;
  } catch {
    return 0;
  }
}

/** Coins-like ({pp,gp,sp,cp} or Coins with copperValue) -> total gp. */
export function coinsToGp(coins) {
  if (!coins) return 0;
  if (typeof coins.copperValue === "number") return coins.copperValue / 100;
  return priceToGp(coins);
}

/** gp (float) -> {pp, gp, sp, cp} integer breakdown. */
export function gpToCoins(gp) {
  let copper = Math.max(0, Math.round(Number(gp ?? 0) * 100));
  const pp = Math.floor(copper / 1000);
  copper -= pp * 1000;
  const gpOut = Math.floor(copper / 100);
  copper -= gpOut * 100;
  const sp = Math.floor(copper / 10);
  copper -= sp * 10;
  return { pp, gp: gpOut, sp, cp: copper };
}

export function copperToCoins(copper) {
  return gpToCoins(Number(copper ?? 0) / 100);
}

/** Same breakdown but never mints platinum — gp/sp/cp only. */
export function copperToCoinsNoPlat(copper) {
  let total = Math.max(0, Math.round(Number(copper ?? 0)));
  const gpOut = Math.floor(total / 100);
  total -= gpOut * 100;
  const sp = Math.floor(total / 10);
  total -= sp * 10;
  return { pp: 0, gp: gpOut, sp, cp: total };
}

/** Human display: "12 gp", "3 sp", "45 cp", negatives keep sign. */
export function formatGp(gp) {
  const v = Number(gp ?? 0);
  if (Object.is(v, -0) || Math.abs(v) < 0.005) return "0 gp";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a < 0.095) return `${sign}${Math.round(a * 100)} cp`;
  if (a < 0.995) {
    const sp = Math.round(a * 10);
    if (sp < 10) return `${sign}${sp} sp`;
  }
  if (Number.isInteger(a)) return `${sign}${a} gp`;
  return `${sign}${a.toFixed(2)} gp`;
}

/**
 * Which party member does the current user claim as?
 * Prefers assigned character, then any owned member actor.
 */
export function myMemberUuid(members, user = game.user) {
  if (!members?.length || !user) return null;
  const assigned = user.character;
  if (assigned && members.some((m) => m.actorId === assigned.id)) {
    return members.find((m) => m.actorId === assigned.id).actorUuid;
  }
  // GMs manage the split; they only claim via an assigned PC that is a member.
  if (user.isGM) return null;
  const owned = members.filter((m) => !!game.actors?.get(m.actorId)?.isOwner);
  return owned[0]?.actorUuid ?? null;
}
