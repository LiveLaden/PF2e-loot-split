/**
 * Loot Split — shared draft window (ApplicationV2, seen by GM and players).
 * Frameless: the native header is hidden via CSS and the template renders its
 * own title bar (draggable) with a ⋮ menu and ✕ button.
 * All state mutations go through globalThis.LootSplit (host GM is authoritative).
 */

import { formatGp, myMemberUuid } from "./helpers.mjs";
import { portraitFit } from "./portrait-fit.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootSplitApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-split",
    classes: ["loot-split-window"],
    tag: "div",
    window: { title: "Loot Split", icon: "fas fa-scale-balanced", resizable: true },
    position: { width: 1060, height: 640 },
    actions: {
      claim: LootSplitApp.#onClaim,
      roll: LootSplitApp.#onRoll,
      award: LootSplitApp.#onAward,
      sell: LootSplitApp.#onSell,
      rolloff: LootSplitApp.#onRolloff,
      rollMissing: LootSplitApp.#onRollMissing,
      awardUncontested: LootSplitApp.#onAwardUncontested,
      exclude: LootSplitApp.#onExclude,
      refresh: LootSplitApp.#onRefresh,
      distCoins: LootSplitApp.#onDistCoins,
      settle: LootSplitApp.#onSettle,
      end: LootSplitApp.#onEnd,
      inspect: LootSplitApp.#onInspect,
      closeWin: LootSplitApp.#onCloseWin,
    },
  };

  static PARTS = {
    main: { template: "modules/loot-split/templates/loot-split.hbs" },
  };

  /** sessionId -> app instance */
  static openApps = new Map();

  session = null;

  constructor(session, options = {}) {
    super(options);
    this.session = session;
  }

  get title() {
    return `Loot Split — ${this.session?.partyName ?? ""}`;
  }

  static open(session) {
    if (!session) return null;
    const existing = LootSplitApp.openApps.get(session.id);
    if (existing && existing.rendered) {
      existing.session = session;
      existing.render({ force: true });
      existing.bringToTop();
      return existing;
    }
    const app = new LootSplitApp(session);
    LootSplitApp.openApps.set(session.id, app);
    // GMs get the wide 3-column window; players a narrower one (no GM column).
    try {
      app.setPosition({ width: game.user.isGM ? 1120 : 800 });
    } catch { /* ignore */ }
    app.render({ force: true });
    globalThis.LootSplit?.updateFab?.();
    return app;
  }

  static updateSession(session) {
    const app = LootSplitApp.openApps.get(session.id);
    if (app) {
      app.session = session;
      if (app.rendered) app.render({ force: true });
    } else {
      LootSplitApp.open(session);
    }
    globalThis.LootSplit?.updateFab?.();
  }

  static closeSession(sessionId) {
    const app = LootSplitApp.openApps.get(sessionId);
    if (app) {
      LootSplitApp.openApps.delete(sessionId);
      app.close({ animate: true });
    }
    globalThis.LootSplit?.updateFab?.();
  }

  async close(options = {}) {
    if (this.session) LootSplitApp.openApps.delete(this.session.id);
    const result = await super.close(options);
    globalThis.LootSplit?.updateFab?.();
    return result;
  }

  /** ---- derived view model ---- */
  #viewModel(fits = new Map()) {
    const s = this.session;
    if (!s) return { hasSession: false, isGM: game.user.isGM };
    const fitStyle = (url) => {
      const f = Number(fits.get(url) ?? 1);
      return Number.isFinite(f) && f !== 1 ? `transform:scale(${f.toFixed(3)})` : null;
    };
    const isGM = game.user.isGM;
    const myUuid = myMemberUuid(s.members);
    const myMember = s.members.find((m) => m.actorUuid === myUuid) ?? null;
    const n = Math.max(1, s.members.length);

    const claimedBy = {};
    for (const m of s.members) claimedBy[m.actorUuid] = Number(s.coinsGiven?.[m.actorUuid] ?? 0);
    for (const it of s.items) {
      if (it.status === "awarded" && it.winnerActorUuid && claimedBy[it.winnerActorUuid] !== undefined) {
        claimedBy[it.winnerActorUuid] += Number(it.totalGp ?? 0);
      }
    }
    const members = s.members.map((m) => {
      const claimed = claimedBy[m.actorUuid] ?? 0;
      const balance = (s.activeShareEach ?? s.shareEach) - claimed;
      const owes = balance < -0.005;
      return { ...m, claimed, claimedDisplay: formatGp(claimed), balance, balanceDisplay: formatGp(owes ? Math.abs(balance) : balance), owes, isMe: m.actorUuid === myUuid, imgStyle: fitStyle(m.img) };
    });
    const openItems = s.items.filter((i) => i.status === "open" || i.status === "rolloff");
    const awardedItems = s.items.filter((i) => i.status === "awarded");
    const soldItems = s.items.filter((i) => i.status === "sold");
    // Display priority: open lots by rarity (unique → common), then awarded, then sold.
    const RARITY_RANK = { unique: 0, rare: 1, uncommon: 2, common: 3 };
    const statusRank = (st) => (st === "awarded" ? 1 : st === "sold" ? 2 : 0);
    const items = s.items.map((it) => {
      const claimants = (it.claimants ?? []).map((c) => {
        const member = s.members.find((m) => m.actorUuid === c.actorUuid);
        // Prefer the live member portrait so chips always match the roster,
        // even for claims placed before a portrait change.
        const cimg = member?.img ?? c.img ?? "icons/svg/mystery-man.svg";
        return {
          ...c,
          img: cimg,
          imgStyle: fitStyle(cimg),
          roll: it.rolls?.[c.actorUuid] ?? null,
          isMe: c.actorUuid === myUuid,
        };
      });
      // Backdrop uses the full actor portrait (not the token crop), resolved
      // live with the snapshot value as fallback.
      const winner = s.members.find((m) => m.actorUuid === it.winnerActorUuid);
      let winnerImg = winner?.actorImg ?? winner?.img ?? null;
      try {
        const live = winner ? game.actors?.get(winner.actorId)?.img : null;
        if (typeof live === "string" && live.length > 0) winnerImg = live;
      } catch { /* keep snapshot value */ }
      return {
        ...it,
        valueDisplay: formatGp(it.totalGp),
        showQty: Number(it.qty ?? 1) > 1,
        isOpen: it.status === "open",
        isRolloff: it.status === "rolloff",
        isAwarded: it.status === "awarded",
        isSold: it.status === "sold",
        soldDisplay: formatGp(it.soldForGp ?? 0),
        sellProceeds: formatGp(Math.floor(Number(it.unitGp ?? 0) * (it.qty ?? 1) * (it.type === "treasure" ? 1 : 0.5) * 100) / 100),
        winnerImg,
        iClaim: (it.claimants ?? []).some((c) => c.actorUuid === myUuid),
        canClaim: !!myMember && !myMember.excluded && (it.status === "open" || it.status === "rolloff"),
        claimants,
        contested: (it.claimants ?? []).length > 1,
        single: (it.claimants ?? []).length === 1,
        needsRoll: it.status === "rolloff" && !!myUuid && (it.claimants ?? []).some((c) => c.actorUuid === myUuid) && it.rolls?.[myUuid] == null,
      };
    });
    items.sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        (RARITY_RANK[a.rarity] ?? 4) - (RARITY_RANK[b.rarity] ?? 4)
    );
    return {
      hasSession: true,
      isGM,
      id: s.id,
      partyName: s.partyName,
      totalDisplay: formatGp(s.initialTotal),
      shareDisplay: formatGp(s.activeShareEach ?? s.shareEach),
      coinsDisplay: formatGp(s.coinSnapshotGp),
      itemsValueDisplay: formatGp(s.itemsSnapshotGp),
      leftDisplay: formatGp(Number(s.itemsSnapshotGp ?? 0) + Number(s.coinSnapshotGp ?? 0)),
      memberCount: s.members.length,
      coinDenoms: s.coinDenoms ?? { pp: 0, gp: 0, sp: 0, cp: 0 },
      hasPlat: Number(s.coinDenoms?.pp ?? 0) > 0,
      members,
      items,
      openItems,
      awardedItems,
      soldItems,
      openCount: openItems.length,
      awardedCount: awardedItems.length,
      soldCount: soldItems.length,
      emptyLots: openItems.length === 0,
      myMember,
      isExcludedMe: !!myMember?.excluded,
      noMember: !myMember && !isGM,
      canClaim: !!myMember,
      log: [...(s.log ?? [])].slice(-6).reverse(),
    };
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    // Resolve portrait fit scales (cached by URL after first load).
    const fits = new Map();
    try {
      const urls = new Set();
      for (const m of this.session?.members ?? []) if (m?.img) urls.add(m.img);
      for (const it of this.session?.items ?? []) {
        for (const c of it.claimants ?? []) {
          const mem = this.session.members.find((m) => m.actorUuid === c.actorUuid);
          if (c.img) urls.add(c.img);
          if (mem?.img) urls.add(mem.img);
        }
      }
      await Promise.all(
        [...urls].map(async (u) => {
          try {
            fits.set(u, await portraitFit(u));
          } catch {
            fits.set(u, 1);
          }
        })
      );
    } catch { /* fall back to unscaled portraits */ }
    if (!this._fitsLogged && fits.size > 0) {
      this._fitsLogged = true;
      console.log("loot-split | portrait fits:", Object.fromEntries(fits));
    }
    return { ...ctx, ...this.#viewModel(fits) };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#makeTitlebarDraggable();
  }

  #makeTitlebarDraggable() {
    const bar = this.element?.querySelector(".ls-titlebar");
    if (!bar || bar.dataset.dragBound) return;
    bar.dataset.dragBound = "1";
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = Number.isFinite(this.position.left) ? this.position.left : 0;
      const origTop = Number.isFinite(this.position.top) ? this.position.top : 0;
      const move = (ev) => {
        this.setPosition({ left: origLeft + ev.clientX - startX, top: origTop + ev.clientY - startY });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  /* ---- actions (all route through the LootSplit API; host GM applies) ---- */

  static async #onClaim(event, target) {
    const itemKey = target.dataset.item;
    await globalThis.LootSplit?.toggleClaim(itemKey);
  }

  static async #onRoll(event, target) {
    const itemKey = target.dataset.item;
    await globalThis.LootSplit?.rollForItem(itemKey);
  }

  static async #onAward(event, target) {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.awardItem(target.dataset.item);
  }

  static async #onSell(event, target) {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.sellItem(target.dataset.item);
  }

  static async #onRolloff(event, target) {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.startRolloff(target.dataset.item);
  }

  static async #onRollMissing(event, target) {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.rollMissing(target.dataset.item);
  }

  static async #onAwardUncontested() {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.awardUncontested();
  }

  static async #onExclude(event, target) {
    if (!game.user.isGM) return;
    // Flip the input immediately so the pill animates on the live element.
    // The re-render after the round-trip lands on the same state.
    try {
      const member = this.session?.members.find((m) => m.actorUuid === target.dataset.member);
      if (member) target.checked = !member.excluded;
    } catch { /* re-render will correct */ }
    await globalThis.LootSplit?.toggleExclude(target.dataset.member);
  }

  static async #onRefresh() {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.refresh();
  }

  static async #onDistCoins() {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.distributeCoins();
  }

  static async #onSettle() {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.settleDebts();
  }

  static async #onEnd() {
    if (!game.user.isGM) return;
    await globalThis.LootSplit?.endSession();
  }

  static async #onInspect(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    try {
      const doc = await fromUuid(uuid);
      doc?.sheet?.render(true, { editable: false });
    } catch (e) {
      console.error("loot-split | inspect:", e);
    }
  }

  static async #onCloseWin() {
    await this.close();
  }
}
