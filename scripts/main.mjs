/**
 * Loot Split — main entry.
 * Host GM is authoritative: all mutations run on the host, then broadcast.
 */

import { LootSplitApp } from "./loot-split-app.mjs";
import {
  coinsToGp, copperToCoins, copperToCoinsNoPlat, formatGp, PHYSICAL_TYPES, priceToGp,
  isPcActor, itemLotValueGp, memberToActor, myMemberUuid,
} from "./helpers.mjs";

const MODULE_ID = "loot-split";
const SOCKET = "module.loot-split";

/* ================= snapshots ================= */

/** Prefer the (usually zoomed-in) token portrait over the actor portrait. */
function memberPortrait(actor) {
  try {
    const tex = actor?.prototypeToken?.texture?.src;
    if (typeof tex === "string" && tex.length > 0) return tex;
  } catch { /* ignore */ }
  return actor?.img ?? "icons/svg/mystery-man.svg";
}

function snapshotMembers(party) {
  const raw = Array.isArray(party?.members) ? party.members : [];
  const out = [];
  for (const entry of raw) {
    const a = memberToActor(entry);
    if (!isPcActor(a)) continue;
    if (out.some((m) => m.actorId === a.id)) continue;
    const portrait = memberPortrait(a);
    out.push({ actorUuid: a.uuid, actorId: a.id, name: a.name, img: portrait, actorImg: a.img ?? portrait });
  }
  return out;
}

/** An item can be a loot lot: physical type and not coinage. */
function isLootable(item) {
  if (!item?.id) return false;
  try {
    if (item.isCoinage === true) return false;
    if (typeof item.isOfType === "function") {
      try {
        if (item.isOfType("physical")) return true;
      } catch { /* fall through to type set */ }
    }
    return PHYSICAL_TYPES.has(item.type);
  } catch {
    return false;
  }
}

/** Stacks up to this size explode into one row per unit so each can be claimed. */
const UNIT_SPLIT_MAX = 8;

function makeLot(item, location, containerId, unit = null) {
  const fullQty = Math.max(1, Number(item.system?.quantity ?? 1));
  const per = Math.max(1, Number(item.system?.price?.per ?? 1));
  const unitGp = priceToGp(item.system?.price?.value) / per;
  const type = item.type;
  const qty = unit ? 1 : fullQty;
  return {
    key: unit ? `${item.id}#${unit}` : item.id,
    itemId: item.id,
    splitUnit: !!unit, // single unit of a larger stack; award moves qty 1
    itemUuid: item.uuid,
    name: item.name,
    img: item.img,
    qty,
    unitGp,
    type,
    level: item.system?.level?.value ?? null,
    rarity: item.system?.traits?.rarity ?? null,
    totalGp: unitGp * qty,
    location: location ?? null, // container name when stowed, for display
    containerId: containerId ?? null, // direct parent embedded-doc id
    claimants: [],
    rolls: {},
    status: "open",
    winnerActorUuid: null,
    winnerName: null,
  };
}

/**
 * Scan the stash the same way the party sheet does: top-level items plus
 * everything stowed inside containers (backpacks, chests, ...), recursively.
 * Coinage is skipped — the fixed Coin Pile row covers coins.
 * Small stacks explode into unit rows so each unit can be claimed separately.
 */
function snapshotItems(party) {
  const lots = [];
  const seen = new Set();

  const pushDoc = (doc, location, containerId) => {
    const lot = makeLot(doc, location, containerId);
    lots.push(lot);
    const fullQty = Math.max(1, Number(doc.system?.quantity ?? 1));
    if (!lot.splitUnit && doc.type !== "backpack" && fullQty > 1 && fullQty <= UNIT_SPLIT_MAX) {
      // Replace the whole-stack row with one row per unit.
      lots.pop();
      for (let u = 1; u <= fullQty; u++) lots.push(makeLot(doc, location, containerId, u));
    }
  };

  const walkContents = (containerItem, trail) => {
    let contents = null;
    try {
      contents = containerItem.contents;
    } catch { /* no contents accessor */ }
    if (!contents) return;
    for (const sub of contents) {
      if (!sub || seen.has(sub.id)) continue;
      seen.add(sub.id);
      if (!isLootable(sub)) continue;
      pushDoc(sub, trail, containerItem.id);
      walkContents(sub, trail); // nested containers
    }
  };

  try {
    for (const item of party?.items ?? []) {
      if (!item || seen.has(item.id)) continue;
      if (!isLootable(item)) continue;
      seen.add(item.id);
      let location = null;
      let containerId = null;
      try {
        if (item.isInContainer === true) {
          location = item.container?.name ?? null;
          containerId = item.container?.id ?? item.system?.containerId ?? null;
        }
      } catch { /* ignore */ }
      pushDoc(item, location, containerId);
      if (item.isInContainer !== true) walkContents(item, item.name);
    }
  } catch (e) {
    console.error("loot-split | stash scan:", e);
  }
  console.log(`loot-split | stash scan: ${lots.length} lot(s) found`);
  return lots;
}

function partyCoinGp(party) {
  try {
    const c = party.inventory?.coins ?? party.inventory?.currency;
    if (c) {
      if (typeof c.copperValue === "number" && c.copperValue > 0) return c.copperValue / 100;
      const g = coinsToGp(c);
      if (g > 0) return g;
    }
  } catch { /* fall through to item scan */ }
  // Fallback: sum coinage items directly (some actor types lack a full inventory).
  try {
    let sum = 0;
    for (const item of party?.items ?? []) {
      try {
        if (item.isCoinage === true) sum += itemLotValueGp(item);
      } catch { /* ignore */ }
    }
    return sum;
  } catch { /* ignore */ }
  return 0;
}

/** Live denomination breakdown of the coin pile (for the fixed coin row). */
function coinDenoms(party, pileGp) {
  try {
    const c = party?.inventory?.coins ?? party?.inventory?.currency;
    if (c) {
      const pp = Number(c.pp ?? 0);
      const gp = Number(c.gp ?? 0);
      const sp = Number(c.sp ?? 0);
      const cp = Number(c.cp ?? 0);
      if (pp + gp + sp + cp > 0) return { pp, gp, sp, cp };
    }
  } catch { /* fall through */ }
  return copperToCoinsNoPlat(Math.round(Number(pileGp ?? 0) * 100));
}

async function resolveParty(session) {
  if (!session) return null;
  try {
    const doc = await fromUuid(session.partyUuid);
    if (doc?.documentName === "Actor") return doc;
  } catch { /* ignore */ }
  return game.actors?.get(session.partyId) ?? null;
}

/** Recompute live money fields. Keeps awarded/coinsGiven so the total stays constant. */
function recount(session, party) {
  // Sold lots are history only: their value already moved into the live-read pile.
  const unawarded = session.items.filter((i) => i.status !== "awarded" && i.status !== "sold");
  session.itemsValueGp = unawarded.reduce((s, i) => s + Number(i.totalGp ?? 0), 0);
  session.coinPileGp = party ? partyCoinGp(party) : (session.coinPileGp ?? 0);
  session.coinDenoms = party
    ? coinDenoms(party, session.coinPileGp)
    : (session.coinDenoms ?? { pp: 0, gp: 0, sp: 0, cp: 0 });
  session.awardedGp = session.items
    .filter((i) => i.status === "awarded")
    .reduce((s, i) => s + Number(i.totalGp ?? 0), 0);
  const givenTotal = Object.values(session.coinsGiven ?? {}).reduce((s, v) => s + Number(v ?? 0), 0);
  session.coinsGivenTotal = givenTotal;
  session.totalGp = session.itemsValueGp + session.coinPileGp + session.awardedGp + givenTotal;
  // Shares NEVER move when someone sits out: divide across all members so the
  // books always close (an excluded member's kept value stays out of the pool
  // instead of inflating everyone else's share).
  const n = Math.max(1, session.members.length);
  session.shareEach = session.totalGp / n;
  // ...but an excluded member's UNCLAIMED remainder flows back: actives split
  // the total minus what sidelined members already took.
  const sidelinedTaken = session.members
    .filter((m) => m.excluded)
    .reduce((s, m) => s + claimedBy(session, m.actorUuid), 0);
  const activeCount = Math.max(1, session.members.filter((m) => !m.excluded).length);
  session.activeShareEach = (session.totalGp - sidelinedTaken) / activeCount;
  // compat aliases used by the template
  session.initialTotal = session.totalGp;
  session.itemsSnapshotGp = session.itemsValueGp;
  session.coinSnapshotGp = session.coinPileGp;
}

function claimedBy(session, actorUuid) {
  let sum = Number(session.coinsGiven?.[actorUuid] ?? 0);
  for (const it of session.items) {
    if (it.status === "awarded" && it.winnerActorUuid === actorUuid) sum += Number(it.totalGp ?? 0);
  }
  return sum;
}

/* ================= persistence + broadcast ================= */

async function persist(session) {
  try {
    await game.settings.set(MODULE_ID, "session", session);
  } catch (e) {
    console.error("loot-split | persist:", e);
  }
}

function broadcast(op, session) {
  game.socket.emit(SOCKET, { scope: MODULE_ID, op, session, sessionId: session?.id ?? null });
}

function currentSession() {
  try {
    return game.settings.get(MODULE_ID, "session") ?? null;
  } catch {
    return null;
  }
}

function isHost(session) {
  return !!game.user.isGM && !!session && session.hostUserId === game.user.id;
}

async function hostCommit(session, party = null) {
  recount(session, party ?? (await resolveParty(session)));
  await persist(session);
  broadcast("update", session);
  LootSplitApp.updateSession(session);
}

function pushLog(session, msg) {
  session.log = [...(session.log ?? []), msg].slice(-30);
}

/**
 * Re-scan the stash into an existing session, preserving claims/rolls/status
 * for items still present. Awarded history is kept for accounting.
 */
async function refreshSession(session) {
  const party = await resolveParty(session);
  if (!party) return session;
  const fresh = snapshotItems(party);
  // Match fresh rows to old ones by doc id, in order (unit rows share an id).
  const oldQueues = new Map();
  for (const old of session.items) {
    if (old.status === "awarded" || old.status === "sold") continue;
    const q = oldQueues.get(old.itemId) ?? [];
    q.push(old);
    oldQueues.set(old.itemId, q);
  }
  const kept = [];
  for (const f of fresh) {
    const old = oldQueues.get(f.itemId)?.shift();
    if (old) {
      f.claimants = old.claimants ?? [];
      f.rolls = old.rolls ?? {};
      f.status = old.status ?? "open";
      f.winnerActorUuid = old.winnerActorUuid ?? null;
      f.winnerName = old.winnerName ?? null;
    }
    kept.push(f);
  }
  for (const old of session.items) {
    if (old.status === "awarded" || old.status === "sold") kept.push(old);
  }
  session.items = kept;
  // Preserve GM exclusion flags across re-scans.
  const prevMembers = new Map(session.members.map((m) => [m.actorId, m]));
  session.members = snapshotMembers(party).map((m) => ({
    ...m,
    excluded: prevMembers.get(m.actorId)?.excluded ?? false,
  }));
  recount(session, party);
  return session;
}

/* Debounced live re-scan: loot added/removed/edited mid-session appears by itself. */
let _rescanTimer = null;
function scheduleRescan() {
  if (!game.user?.isGM) return;
  const s = currentSession();
  if (!s?.id || s.hostUserId !== game.user.id) return;
  clearTimeout(_rescanTimer);
  _rescanTimer = setTimeout(async () => {
    try {
      let session = currentSession();
      if (!session?.id || session.hostUserId !== game.user.id) return;
      const before = session.items.map((i) => `${i.itemId}:${i.status}:${i.qty}`).join(",");
      const coinsBefore = Number(session.coinPileGp ?? 0);
      session = await refreshSession(session);
      const after = session.items.map((i) => `${i.itemId}:${i.status}:${i.qty}`).join(",");
      if (before !== after) pushLog(session, "Stash changed — list updated.");
      await persist(session);
      broadcast("update", session);
      LootSplitApp.updateSession(session);
      if (before !== after || Number(session.coinPileGp ?? 0) !== coinsBefore) {
        console.log("loot-split | live re-scan applied");
      }
    } catch (e) {
      console.error("loot-split | live re-scan:", e);
    }
  }, 600);
}

function stashChangedForSession(itemDoc) {
  try {
    const s = currentSession();
    if (!s?.id) return false;
    const actorUuid = itemDoc?.parent?.uuid ?? itemDoc?.actor?.uuid ?? null;
    return !!actorUuid && actorUuid === s.partyUuid;
  } catch {
    return false;
  }
}

/* ================= transfers (host GM only) ================= */

/**
 * Move one embedded stash doc to the winner.
 * Returns { ok, newId }. Pass the new container id so stowed contents keep working.
 */
async function moveStashDoc(party, winner, stashId, containerId) {
  const doc = party.items.get(stashId);
  if (!doc) return { ok: false, newId: null };
  const qty = Math.max(1, Number(doc.system?.quantity ?? 1));
  let newId = null;
  try {
    const stack = !containerId ? winner.inventory?.findStackableItem?.(doc) : null;
    if (stack) {
      await winner.updateEmbeddedDocuments("Item", [
        { _id: stack.id, "system.quantity": Number(stack.system?.quantity ?? 1) + qty },
      ]);
      newId = stack.id;
    } else {
      const obj = doc.toObject();
      obj.system = obj.system ?? {};
      obj.system.containerId = containerId ?? null; // never inherit the stash container
      const created = await winner.createEmbeddedDocuments("Item", [obj]);
      newId = created?.[0]?.id ?? null;
    }
  } catch (e) {
    console.error("loot-split | transfer:", e);
    return { ok: false, newId: null };
  }
  try {
    await doc.delete();
  } catch (e) {
    console.error("loot-split | delete stash item:", e);
  }
  return { ok: true, newId };
}

/**
 * Move a single unit of a stacked doc to the winner (split-unit rows).
 * The stash doc keeps the remainder.
 */
async function awardOneUnit(party, winner, stashId) {
  const doc = party.items.get(stashId);
  if (!doc) return { ok: false, newId: null };
  const qty = Math.max(1, Number(doc.system?.quantity ?? 1));
  if (qty <= 1) return moveStashDoc(party, winner, stashId, null);
  try {
    const stack = winner.inventory?.findStackableItem?.(doc);
    let newId = null;
    if (stack) {
      await winner.updateEmbeddedDocuments("Item", [
        { _id: stack.id, "system.quantity": Number(stack.system?.quantity ?? 1) + 1 },
      ]);
      newId = stack.id;
    } else {
      const obj = doc.toObject();
      obj.system = obj.system ?? {};
      obj.system.quantity = 1;
      obj.system.containerId = null;
      const created = await winner.createEmbeddedDocuments("Item", [obj]);
      newId = created?.[0]?.id ?? null;
    }
    await doc.update({ "system.quantity": qty - 1 });
    return { ok: true, newId };
  } catch (e) {
    console.error("loot-split | transfer unit:", e);
    return { ok: false, newId: null };
  }
}

async function moveCoins(fromActor, toActor, copper, { noPlatinum = false } = {}) {
  const coins = noPlatinum ? copperToCoinsNoPlat(copper) : copperToCoins(copper);
  let ok = true;
  try {
    const res = await fromActor.inventory?.removeCoins?.(coins);
    if (res === false) ok = false;
  } catch {
    ok = false;
  }
  if (!ok) return false;
  try {
    await toActor.inventory?.addCoins?.(coins);
  } catch (e) {
    console.error("loot-split | addCoins:", e);
  }
  return true;
}

async function chat(content, alias) {
  try {
    await ChatMessage.create({ content, speaker: { alias: alias ?? "Loot Split" } });
  } catch (e) {
    console.error("loot-split | chat:", e);
  }
}

/* ================= host operations ================= */

async function hostAwardItem(session, itemKey, winnerOverrideUuid = null) {
  const party = await resolveParty(session);
  if (!party) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  const item = session.items.find((i) => i.key === itemKey);
  if (!item || item.status === "awarded") return;
  const winnerUuid = winnerOverrideUuid ?? item.claimants?.[0]?.actorUuid;
  const winnerEntry = session.members.find((m) => m.actorUuid === winnerUuid);
  if (!winnerEntry) return;
  const winner = game.actors?.get(winnerEntry.actorId);
  if (!winner) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  const doc = party.items.get(item.itemId);
  if (!doc) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }

  // Contents stowed inside an awarded container ride along with it.
  const rideAlongs = [];
  {
    const queue = [item.itemId];
    const seenC = new Set(queue);
    while (queue.length) {
      const cid = queue.shift();
      for (const lot of session.items) {
        if (lot.status === "awarded" || lot.key === item.key) continue;
        if (lot.containerId === cid && !seenC.has(lot.itemId)) {
          seenC.add(lot.itemId);
          rideAlongs.push(lot);
          queue.push(lot.itemId);
        }
      }
    }
  }

  // A split-unit row moves a single unit; everything else moves the whole doc.
  const moved = item.splitUnit
    ? await awardOneUnit(party, winner, item.itemId)
    : await moveStashDoc(party, winner, item.itemId, null);
  if (!moved.ok) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  const idMap = new Map([[item.itemId, moved.newId]]);
  const extraNames = [];
  for (const lot of rideAlongs) {
    if (!party.items.get(lot.itemId)) continue;
    const res = await moveStashDoc(party, winner, lot.itemId, idMap.get(lot.containerId) ?? null);
    if (res.ok) {
      idMap.set(lot.itemId, res.newId);
      lot.status = "awarded";
      lot.winnerActorUuid = winnerEntry.actorUuid;
      lot.winnerName = winnerEntry.name;
      extraNames.push(lot.name);
    }
  }

  const markWon = (lot) => {
    lot.status = "awarded";
    lot.winnerActorUuid = winnerEntry.actorUuid;
    lot.winnerName = winnerEntry.name;
  };
  markWon(item);
  const extra = extraNames.length ? ` (+${extraNames.length} inside: ${extraNames.join(", ")})` : "";
  pushLog(session, `${winnerEntry.name} ← ${item.name} (${formatGp(item.totalGp)})${extraNames.length ? ` +${extraNames.length} inside` : ""}`);
  await chat(
    `<p><strong>${winnerEntry.name}</strong> receives <strong>${item.name}</strong> (${formatGp(item.totalGp)}).${extra}</p>`,
    "Loot Split"
  );
  await hostCommit(session, party);
}

/**
 * Sell a lot into the pile (host GM only). Treasure sells at full value,
 * everything else at half (PF2e selling rules), rounded down to the copper.
 * Unit rows sell a single unit; whole rows sell the full stack. Coins first,
 * then the item is removed, so a failed payout never loses the item.
 */
async function hostSellItem(session, itemKey) {
  const party = await resolveParty(session);
  if (!party) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  const item = session.items.find((i) => i.key === itemKey);
  if (!item || item.status !== "open") return;
  const doc = party.items.get(item.itemId);
  if (!doc) {
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  const docQty = Math.max(1, Number(doc.system?.quantity ?? 1));
  const sellQty = item.splitUnit ? 1 : docQty;
  const rate = item.type === "treasure" ? 1 : 0.5;
  const saleCopper = Math.floor(Number(item.unitGp ?? 0) * sellQty * rate * 100);
  try {
    if (saleCopper > 0) {
      // Pile proceeds never mint platinum: gold/silver/copper only.
      await party.inventory?.addCoins?.(copperToCoinsNoPlat(saleCopper));
    }
  } catch (e) {
    console.error("loot-split | sell payout:", e);
    ui.notifications.error(game.i18n.localize("LOOT_SPLIT.ItemGone"));
    return;
  }
  try {
    if (item.splitUnit && docQty > 1) {
      await doc.update({ "system.quantity": docQty - sellQty });
    } else {
      await doc.delete();
    }
  } catch (e) {
    console.error("loot-split | sell remove:", e);
  }
  item.status = "sold";
  item.soldForGp = saleCopper / 100;
  item.soldQty = sellQty;
  item.claimants = [];
  item.rolls = {};
  pushLog(session, `Sold ${item.name}${sellQty > 1 ? ` ×${sellQty}` : ""} for ${formatGp(item.soldForGp)}.`);
  await chat(
    `<p>Sold <strong>${item.name}</strong>${sellQty > 1 ? ` ×${sellQty}` : ""} for <strong>${formatGp(item.soldForGp)}</strong> into the pile.</p>`,
    "Loot Split"
  );
  await hostCommit(session, party);
}

function hostResolveRolloff(session, item) {
  const rolls = item.rolls ?? {};
  const ids = (item.claimants ?? []).map((c) => c.actorUuid);
  if (!ids.every((id) => rolls[id] != null)) return false; // waiting on more rolls
  const scored = ids.map((id) => ({ id, roll: Number(rolls[id]) }));
  const best = Math.max(...scored.map((s) => s.roll));
  const tied = scored.filter((s) => s.roll === best);
  if (tied.length > 1) {
    item.rolls = {};
    const names = tied.map((t) => session.members.find((m) => m.actorUuid === t.id)?.name ?? t.id).join(", ");
    pushLog(session, `Tie on ${item.name} (${best}) — ${names} roll again.`);
    chat(`<p>Tie on <strong>${item.name}</strong> (${best}) — ${names} roll again.</p>`, "Loot Split");
    return true; // state changed, needs commit (no award)
  }
  const winner = tied[0];
  const name = session.members.find((m) => m.actorUuid === winner.id)?.name ?? winner.id;
  pushLog(session, `${name} wins ${item.name} (d100: ${winner.roll}).`);
  chat(`<p><strong>${name}</strong> wins <strong>${item.name}</strong> with <strong>${winner.roll}</strong> on a d100.</p>`, "Loot Split");
  return { winnerId: winner.id };
}

async function hostHandleRequest(msg) {
  let session = currentSession();
  if (!session || msg.sessionId !== session.id) return;
  if (!isHost(session)) return; // only the host applies mutations
  const party = await resolveParty(session);

  switch (msg.op) {
    case "claim": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      const member = session.members.find((m) => m.actorUuid === msg.memberActorUuid);
      if (!item || !member || (item.status !== "open" && item.status !== "rolloff") || member.excluded) return;
      item.claimants = item.claimants ?? [];
      const idx = item.claimants.findIndex((c) => c.actorUuid === member.actorUuid);
      if (msg.want && idx === -1) {
        item.claimants.push({ actorUuid: member.actorUuid, actorId: member.actorId, name: member.name, img: member.img, userId: msg.userId });
        if (item.status === "rolloff") item.rolls = {}; // new claimant resets the roll-off
      } else if (!msg.want && idx !== -1) {
        item.claimants.splice(idx, 1);
        if (item.rolls) delete item.rolls[member.actorUuid];
        if (item.status === "rolloff" && item.claimants.length < 2) {
          item.status = "open";
          item.rolls = {};
        }
      }
      await hostCommit(session, party);
      break;
    }
    case "rollRecord": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      if (!item || item.status !== "rolloff") return;
      if (!(item.claimants ?? []).some((c) => c.actorUuid === msg.memberActorUuid)) return;
      item.rolls = item.rolls ?? {};
      item.rolls[msg.memberActorUuid] = Math.max(1, Math.min(100, Number(msg.value)));
      const outcome = hostResolveRolloff(session, item);
      if (outcome && outcome.winnerId) {
        await persist(session);
        broadcast("update", session);
        LootSplitApp.updateSession(session);
        await hostAwardItem(session, item.key, outcome.winnerId);
      } else {
        await hostCommit(session, party);
      }
      break;
    }
    case "award": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      if (!item || item.status === "awarded") return;
      if ((item.claimants ?? []).length !== 1) {
        if (game.user.id === session.hostUserId) ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NeedOneClaimant"));
        return;
      }
      await hostAwardItem(session, item.key);
      break;
    }
    case "sell": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      if (!item || item.status !== "open") return;
      await hostSellItem(session, item.key);
      break;
    }
    case "rolloff": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      if (!item || item.status !== "open") return;
      if ((item.claimants ?? []).length < 2) {
        ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NeedTwoClaimants"));
        return;
      }
      item.status = "rolloff";
      item.rolls = {};
      pushLog(session, `Roll-off opened for ${item.name}.`);
      await chat(`<p>Roll-off for <strong>${item.name}</strong> — claimants, roll d100 from the loot window.</p>`, "Loot Split");
      await hostCommit(session, party);
      break;
    }
    case "rollMissing": {
      const item = session.items.find((i) => i.key === msg.itemKey);
      if (!item || item.status !== "rolloff") return;
      item.rolls = item.rolls ?? {};
      for (const c of item.claimants ?? []) {
        if (item.rolls[c.actorUuid] != null) continue;
        const r = await new Roll("1d100").evaluate();
        await r.toMessage({ speaker: { alias: c.name }, flavor: `Loot Split — ${item.name}` });
        item.rolls[c.actorUuid] = r.total;
      }
      const outcome = hostResolveRolloff(session, item);
      if (outcome && outcome.winnerId) {
        await persist(session);
        broadcast("update", session);
        LootSplitApp.updateSession(session);
        await hostAwardItem(session, item.key, outcome.winnerId);
      } else {
        await hostCommit(session, party);
      }
      break;
    }
    case "awardUncontested": {
      const targets = session.items.filter((i) => i.status === "open" && (i.claimants ?? []).length === 1);
      for (const t of targets) {
        await hostAwardItem(currentSession(), t.key);
        session = currentSession();
      }
      break;
    }
    case "exclude": {
      const member = session.members.find((m) => m.actorUuid === msg.memberActorUuid);
      if (!member) return;
      member.excluded = !!msg.excluded;
      // An excluded member's open claims are released.
      if (member.excluded) {
        for (const lot of session.items) {
          if (lot.status !== "awarded" && (lot.claimants ?? []).some((c) => c.actorUuid === member.actorUuid)) {
            lot.claimants = (lot.claimants ?? []).filter((c) => c.actorUuid !== member.actorUuid);
            if (lot.rolls) delete lot.rolls[member.actorUuid];
            if (lot.status === "rolloff" && lot.claimants.length < 2) {
              lot.status = "open";
              lot.rolls = {};
            }
          }
        }
      }
      pushLog(session, `${member.name} ${member.excluded ? "sat out" : "rejoined"} the split.`);
      await hostCommit(session, party);
      break;
    }
    case "refresh": {
      session = await refreshSession(session);
      const n = session.items.filter((i) => i.status !== "awarded").length;
      pushLog(session, `Stash re-read (${n} lots).`);
      ui.notifications.info(`Loot Split: stash re-read — ${n} lot(s).`);
      await hostCommit(session);
      break;
    }
    case "distCoins": {
      if (!party) return;
      recount(session, party);
      const pileCopper = Math.round(partyCoinGp(party) * 100);
      if (pileCopper <= 0) {
        ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NothingToDistribute"));
        return;
      }
      // Only members still owed value receive coins; debtors are skipped.
      const entries = [];
      for (const m of session.members) {
        if (m.excluded) continue;
        const actor = game.actors?.get(m.actorId);
        const balance = Math.round(((session.activeShareEach ?? session.shareEach) - claimedBy(session, m.actorUuid)) * 100);
        if (!actor || balance <= 0) continue;
        entries.push({ m, actor, balance, given: 0 });
      }
      if (!entries.length) {
        ui.notifications.info(game.i18n.localize("LOOT_SPLIT.AllFull"));
        return;
      }
      // Water-fill: split evenly, cap each share at what the member is still
      // owed, and redistribute any leftover across the remaining members.
      let remaining = pileCopper;
      let eligible = [...entries];
      let guard = 0;
      while (remaining > 0 && eligible.length > 0 && guard++ < 100) {
        const share = Math.floor(remaining / eligible.length);
        if (share <= 0) break; // dust stays in the pile
        let progress = false;
        for (const e of [...eligible]) {
          if (remaining <= 0) break;
          const give = Math.min(share, e.balance, remaining);
          if (give <= 0) {
            eligible = eligible.filter((x) => x !== e);
            continue;
          }
          const ok = await moveCoins(party, e.actor, give);
          if (!ok) {
            eligible = eligible.filter((x) => x !== e);
            continue;
          }
          e.balance -= give;
          e.given += give;
          remaining -= give;
          session.coinsGiven[e.m.actorUuid] = Number(session.coinsGiven?.[e.m.actorUuid] ?? 0) + give / 100;
          progress = true;
          if (e.balance <= 0) eligible = eligible.filter((x) => x !== e);
        }
        if (!progress) break;
      }
      const paid = entries.filter((e) => e.given > 0);
      const totalGiven = paid.reduce((s, e) => s + e.given, 0) / 100;
      if (totalGiven <= 0) {
        ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NothingToDistribute"));
        await hostCommit(session, party);
        return;
      }
      const parts = paid.map((e) => `${e.m.name} ${formatGp(e.given / 100)}`).join(", ");
      pushLog(session, `Split ${formatGp(totalGiven)} in coins (${paid.length}/${entries.length} PCs).`);
      await chat(`<p>Split <strong>${formatGp(totalGiven)}</strong> in coins: ${parts}.</p>`, "Loot Split");
      ui.notifications.info(`Loot Split: distributed ${formatGp(totalGiven)} in coins.`);
      await hostCommit(session, party);
      break;
    }
    case "settle": {
      if (!party) return;
      recount(session, party);
      let any = false;
      for (const m of session.members) {
        if (m.excluded) continue;
        const balance = (session.activeShareEach ?? session.shareEach) - claimedBy(session, m.actorUuid);
        if (balance >= -0.005) continue;
        const debtor = game.actors?.get(m.actorId);
        if (!debtor) continue;
        const copper = Math.round(-balance * 100);
        const ok = await moveCoins(debtor, party, copper, { noPlatinum: true });
        if (ok) {
          session.coinsGiven[m.actorUuid] = Number(session.coinsGiven?.[m.actorUuid] ?? 0) - copper / 100;
          pushLog(session, `${m.name} paid back ${formatGp(copper / 100)}.`);
          any = true;
        } else {
          await chat(`<p><strong>${m.name}</strong> cannot cover ${formatGp(copper / 100)} — not enough coins.</p>`, "Loot Split");
        }
      }
      if (!any) ui.notifications.info(game.i18n.localize("LOOT_SPLIT.NoDebts"));
      await hostCommit(session, party);
      break;
    }
    case "end": {
      await persist(null);
      game.socket.emit(SOCKET, { scope: MODULE_ID, op: "close", sessionId: session.id });
      LootSplitApp.closeSession(session.id);
      await chat("Loot split ended.", "Loot Split");
      break;
    }
  }
}

/* ================= public API (every client) ================= */

function sendOrApply(op, payload = {}) {
  const session = currentSession();
  if (!session) return;
  if (isHost(session)) {
    return hostHandleRequest({ scope: MODULE_ID, op, sessionId: session.id, userId: game.user.id, ...payload });
  }
  game.socket.emit(SOCKET, { scope: MODULE_ID, op, sessionId: session.id, userId: game.user.id, ...payload });
}

async function confirmDialog(message) {
  try {
    return !!(await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("LOOT_SPLIT.Title") },
      content: `<p>${message}</p>`,
      rejectClose: false,
    }));
  } catch {
    return false;
  }
}

const LootSplit = {
  async startForParty(partyUuid) {
    if (!game.user.isGM) return;
    let party = null;
    try {
      party = await fromUuid(partyUuid);
    } catch { /* ignore */ }
    if (!party || party.type !== "party") return;

    const existing = currentSession();
    if (existing?.id) {
      if (existing.partyUuid === party.uuid) {
        // Same party: re-scan so the window always shows the current stash, then reopen for all.
        const session = await refreshSession(existing);
        await persist(session);
        broadcast("start", session);
        LootSplitApp.updateSession(session);
        const n = session.items.filter((i) => i.status !== "awarded").length;
        ui.notifications.info(`Loot Split reopened: ${n} lot(s), ${formatGp(session.totalGp)} total.`);
        return;
      }
      const open = await confirmDialog(game.i18n.localize("LOOT_SPLIT.SessionActive"));
      if (!open) return;
    }

    const members = snapshotMembers(party);
    if (!members.length) {
      ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NoPCs"));
      return;
    }
    const session = {
      id: foundry.utils.randomID(),
      hostUserId: game.user.id,
      partyUuid: party.uuid,
      partyId: party.id,
      partyName: party.name,
      members: members.map((m) => ({ ...m, excluded: false })),
      items: snapshotItems(party),
      coinsGiven: {},
      log: [`Split opened for ${party.name}: ${members.length} PCs.`],
      createdAt: Date.now(),
    };
    recount(session, party);
    await persist(session);
    broadcast("start", session);
    LootSplitApp.updateSession(session);
    if (session.items.length === 0) {
      ui.notifications.warn("Loot Split: no splittable items found in the stash (coins are still counted).");
    } else {
      ui.notifications.info(`Loot Split: ${session.items.length} lot(s), ${formatGp(session.totalGp)} total.`);
    }
    await chat(`<p><strong>Loot split</strong> started for ${party.name} — ${members.length} PCs, total ${formatGp(session.totalGp)} (${formatGp(session.shareEach)} each).</p>`, "Loot Split");
  },

  async toggleClaim(itemKey) {
    const session = currentSession();
    if (!session) return;
    const myUuid = myMemberUuid(session.members);
    if (!myUuid) {
      ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.NoCharacter"));
      return;
    }
    if (session.members.find((m) => m.actorUuid === myUuid)?.excluded) {
      ui.notifications.warn(game.i18n.localize("LOOT_SPLIT.Excluded"));
      return;
    }
    const item = session.items.find((i) => i.key === itemKey);
    if (!item || item.status === "awarded") return;
    const want = !(item.claimants ?? []).some((c) => c.actorUuid === myUuid);
    return sendOrApply("claim", { itemKey, memberActorUuid: myUuid, want });
  },

  async rollForItem(itemKey) {
    const session = currentSession();
    if (!session) return;
    const myUuid = myMemberUuid(session.members);
    if (!myUuid) return;
    const item = session.items.find((i) => i.key === itemKey);
    if (!item || item.status !== "rolloff") return;
    if (!(item.claimants ?? []).some((c) => c.actorUuid === myUuid)) return;
    if (item.rolls?.[myUuid] != null) return;
    const me = session.members.find((m) => m.actorUuid === myUuid);
    const roll = await new Roll("1d100").evaluate();
    try {
      await roll.toMessage({ speaker: { alias: me?.name ?? game.user.name }, flavor: `Loot Split — ${item.name}` });
    } catch (e) {
      console.error("loot-split | roll message:", e);
    }
    if (isHost(session)) {
      return hostHandleRequest({ scope: MODULE_ID, op: "rollRecord", sessionId: session.id, userId: game.user.id, itemKey, memberActorUuid: myUuid, value: roll.total });
    }
    game.socket.emit(SOCKET, { scope: MODULE_ID, op: "rollRecord", sessionId: session.id, userId: game.user.id, itemKey, memberActorUuid: myUuid, value: roll.total });
  },

  awardItem(itemKey) { return sendOrApply("award", { itemKey }); },
  async sellItem(itemKey) {
    if (!game.user.isGM) return;
    const session = currentSession();
    const item = session?.items.find((i) => i.key === itemKey);
    if (!item || item.status !== "open") return;
    if ((item.claimants ?? []).length > 0) {
      const names = item.claimants.map((c) => c.name).join(", ");
      const ok = await confirmDialog(
        `${game.i18n.localize("LOOT_SPLIT.ConfirmSellClaimed")} (${names})`
      );
      if (!ok) return;
    }
    return sendOrApply("sell", { itemKey });
  },
  startRolloff(itemKey) { return sendOrApply("rolloff", { itemKey }); },
  rollMissing(itemKey) { return sendOrApply("rollMissing", { itemKey }); },
  awardUncontested() { return sendOrApply("awardUncontested"); },
  async refresh() {
    if (!(await confirmDialog(game.i18n.localize("LOOT_SPLIT.ConfirmRefresh")))) return;
    return sendOrApply("refresh");
  },
  async distributeCoins() {
    if (!(await confirmDialog(game.i18n.localize("LOOT_SPLIT.ConfirmDistCoins")))) return;
    return sendOrApply("distCoins");
  },
  async settleDebts() {
    if (!(await confirmDialog(game.i18n.localize("LOOT_SPLIT.ConfirmSettle")))) return;
    return sendOrApply("settle");
  },

  async endSession() {
    const session = currentSession();
    if (!session || !game.user.isGM) return;
    const ok = await confirmDialog(game.i18n.localize("LOOT_SPLIT.ConfirmEnd"));
    if (!ok) return;
    return sendOrApply("end");
  },

  toggleExclude(memberActorUuid) {
    if (!game.user.isGM) return;
    // Let the knob animation finish before committing, so it always plays
    // instead of being cut by the re-render. Intent is read fresh at fire
    // time, so rapid toggles still converge correctly.
    setTimeout(() => {
      const session = currentSession();
      if (!session) return;
      const member = session.members.find((m) => m.actorUuid === memberActorUuid);
      if (!member) return;
      sendOrApply("exclude", { memberActorUuid, excluded: !member.excluded });
    }, 240);
  },

  /** Reopen the window for the current session (used by the corner button). */
  async reopen() {
    const session = currentSession();
    if (!session?.id) return;
    if (isHost(session)) {
      const fresh = await refreshSession(session);
      await persist(fresh);
      broadcast("start", fresh);
      LootSplitApp.updateSession(fresh);
    } else {
      LootSplitApp.updateSession(session);
    }
    LootSplit.updateFab();
  },

  async clearStash(partyUuid) {
    if (!game.user.isGM) return;
    let party = null;
    try {
      party = await fromUuid(partyUuid);
    } catch { /* ignore */ }
    if (!party || party.type !== "party") return;
    const ok = await confirmDialog(game.i18n.localize("LOOT_SPLIT.ConfirmClearStash"));
    if (!ok) return;
    const ids = [...(party.items ?? [])].map((i) => i.id).filter(Boolean);
    if (!ids.length) {
      ui.notifications.info("Loot Split: the stash is already empty.");
      return;
    }
    try {
      await party.deleteEmbeddedDocuments("Item", ids);
      ui.notifications.info(`Loot Split: cleared ${ids.length} item(s) from the stash.`);
    } catch (e) {
      console.error("loot-split | clear stash:", e);
      ui.notifications.error("Loot Split: failed to clear the stash.");
    }
  },

  /** Show/hide the corner reopen button while a split is active. */
  updateFab() {
    try {
      const s = currentSession();
      const open = !!s?.id && LootSplitApp.openApps.has(s.id);
      let fab = document.getElementById("loot-split-fab");
      if (s?.id && !open) {
        if (!fab) {
          fab = document.createElement("button");
          fab.id = "loot-split-fab";
          fab.type = "button";
          fab.title = "Loot Split active — reopen";
          fab.innerHTML = `<i class="fas fa-scale-balanced"></i>`;
          fab.addEventListener("click", () => LootSplit.reopen());
          document.body.appendChild(fab);
          positionFab();
        }
        fab.style.display = "";
      } else if (fab) {
        fab.style.display = "none";
      }
    } catch (e) {
      console.error("loot-split | fab:", e);
    }
  },
};

/** Keep the corner button clear of the sidebar (full vs collapsed). */
function positionFab() {
  try {
    const fab = document.getElementById("loot-split-fab");
    if (!fab) return;
    const sidebar = document.getElementById("sidebar");
    const collapsed = sidebar?.classList.contains("collapsed");
    fab.style.right = collapsed ? "46px" : "318px";
  } catch { /* ignore */ }
}

/* ================= socket ================= */

function registerSocket() {
  game.socket.on(SOCKET, async (msg) => {
    try {
      if (!msg || msg.scope !== MODULE_ID) return;
      if (msg.op === "start" || msg.op === "update") {
        if (msg.session) LootSplitApp.updateSession(msg.session);
        LootSplit.updateFab();
        return;
      }
      if (msg.op === "close") {
        if (msg.sessionId) LootSplitApp.closeSession(msg.sessionId);
        LootSplit.updateFab();
        return;
      }
      // client -> host requests
      const session = currentSession();
      if (session && msg.sessionId === session.id && isHost(session)) {
        await hostHandleRequest(msg);
      }
    } catch (e) {
      console.error("loot-split | socket:", e);
    }
  });
}

/* ================= party sheet button ================= */

function injectSplitButton(app, html) {
  try {
    const actor = app.actor ?? app.object;
    if (actor?.type !== "party") return;
    if (!game.user?.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
    if (!root?.querySelector) return;
    const invSection = root.querySelector(".tab.inventory section.inventory");
    if (!invSection || invSection.querySelector(".loot-split-launch")) return;
    const bar = document.createElement("div");
    bar.className = "loot-split-launch";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ls-launch-split";
    btn.innerHTML = `<i class="fas fa-scale-balanced"></i> ${game.i18n.localize("LOOT_SPLIT.SplitLoot")}`;
    btn.addEventListener("click", () => LootSplit.startForParty(actor.uuid));
    bar.appendChild(btn);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ls-launch-clear";
    clear.title = game.i18n.localize("LOOT_SPLIT.ClearStashHint");
    clear.innerHTML = `<i class="fas fa-trash"></i> ${game.i18n.localize("LOOT_SPLIT.ClearStash")}`;
    clear.addEventListener("click", () => LootSplit.clearStash(actor.uuid));
    bar.appendChild(clear);
    invSection.prepend(bar);
  } catch (e) {
    console.error("loot-split | inject:", e);
  }
}

/* ================= lifecycle ================= */

Hooks.once("init", () => {
  console.log(`loot-split | v${game.modules?.get(MODULE_ID)?.version ?? "?"} initialising`);
  game.settings.register(MODULE_ID, "session", {
    scope: "world",
    config: false,
    type: Object,
    default: null,
  });
  foundry.applications?.handlebars?.loadTemplates(["modules/loot-split/templates/loot-split.hbs"]);
  globalThis.LootSplit = LootSplit;
});

Hooks.once("ready", () => {
  registerSocket();
  Hooks.on("renderActorSheet", injectSplitButton);
  // Live re-scan while a split is active (host only; scheduleRescan re-checks).
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (doc) => {
      if (stashChangedForSession(doc)) scheduleRescan();
    });
  }
  // Reopen an in-progress split for everyone (covers reloads / late joins).
  const session = currentSession();
  if (session?.id) LootSplitApp.updateSession(session);
  LootSplit.updateFab();
  Hooks.on("collapseSidebar", () => positionFab());
});
