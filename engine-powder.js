(function () {
// Chasing Powder, economic engine v2 (node). Single source of economic truth.
// HARD GATE: no multiplayer UI until the balance gates below PASS.
// Run: node chasing-powder.js   (prints the gate report)
//
// v2 SPATIAL REWRITE (2026-07-16): position generalized from a 1D scalar to a 3-facet
// capability vector [terrain, comfort, priceAccess]. Position no longer moves via a
// target-and-budget resolver reading advantage bets; it moves ONLY as a consequence of
// lever spend each season (addRuns, buildLodging, summerEvents, marketing, two continuous
// prices), realized through an IMPERFECT MOVEMENT model (demand mass + rival crowding
// scale how much of your intended move actually lands). The old 12-type advantage/decay
// bet system (ai/terrain/network/coalition/estate/snowmaking/values/exclusion/cost/niche/
// summer/brand) is retired; its economic roles now attach to POSITION ZONES (camp at the
// Core extreme and you earn the zone perks; stop moving and track-out decay erodes your
// fit) rather than to discrete purchased bets. See SPATIAL-UI-VISION.md + HANDOFF-SPATIAL-BUILD.md.
//
// What this engine proves (or fails to prove) before any UI is built:
//   G1 viability: several archetypes each win a fair share (no dead, no dominant)
//   G2 THE core gate: renewal (adaptive Chaser) beats coasting (Coast) on economics ALONE
//   G3 bounded snowball: an early lead helps but does not determine the outcome
//   G4 snow < strategy: strategy explains more score variance than snow luck
//   G5 track-out bites: a held position decays faster (loses "live" seasons) post-inflection
//   G6 peak is not win: the biggest single-season edge usually does NOT win
//   G7 world-flip: every archetype wins in some environment quadrant, none dominates all
//
// The engine is deliberately tunable via CONFIG. The build loop = adjust CONFIG,
// re-run, read the gates, repeat. Do not build UI past a failing gate.

// ---------- deterministic RNG (seeded, so gate results are reproducible) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- CONFIG (the tuning surface) ----------
const CONFIG = {
  SEASONS: 6,
  INFLECTION: 3,                 // start of season 4 (0-indexed): AI access hits everyone
  // Market size is expressed PER FIRM and multiplied by the field size at use, so adding seats for a
  // bigger class does not thin every resort's slice. That is what lets the same tuned constants hold
  // whether four teams turn up or eight. BASE_MARKET is kept as the derived total for any old reader.
  MARKET_PER_FIRM: 63.3,         // skier-day units per firm in season 0
  BASE_MARKET: 380,              // derived: MARKET_PER_FIRM * 6, the historical six-firm total
  growth:    [0.18, 0.12, 0.06, 0.03, 0.01, -0.01],   // hidden life-cycle demand growth
  coreShare: [0.78, 0.66, 0.52, 0.42, 0.35, 0.31],    // RETIRED 2026-07-16 by the 5-segment lifecycle (SEGMENTS[].massTraj
                                  // below replaces this); left in place only because it's dead weight, not read anywhere.
  snow: { powder: 1.15, normal: 1.0, drought: 0.82 }, // yield multiplier on the weather-exposed part
  snowStay: 0.5,                 // Markov persistence
  inflectionDecayMult: 1.8,      // decay accelerates for everyone after the inflection (now: track-out speed)
  inflectionEdgeLifeCut: 1,      // reserved (grace-period shortening hook)
  growthSpread: 0.5692271527135745,           // per-game how much the demand-growth curve is scaled up or down
  chasmSpread: 0.6315891261212527,            // per-game how much faster or slower the Core->Mainstream shift runs
  fixedCost: 14,                 // per-resort fixed cost per season
  capCarry: 0.05386728260433302,              // carrying cost per unit of capacity per season (idle capacity hurts)
  // competitive action / AMC subsystem: typed moves; a target answers back only if aware+motivated+capable (see aiMoveNode/amcScore)
  attackIntensity: { VOLUME: 0.73, RENEWER: 0.16, NETWORK: 0.77, PREMIUM: 0.22, FORTRESS: 0.28, COST: 0.47, COAST: 0 },  // legacy, unused by the typed-move engine
  raidShift: 0.36412161411717536,              // segment appeal a landed attack pulls from the target
  warCost: 10.628650646656752,                 // margin each side pays in a price war (retaliated, Chen: aware+motivated+capable)
  retaliateFloor: 35.05839351564646,         // cash a target needs to be "capable" of answering
  leadPenalty: 0.0050371475354768335,           // rubber-band: extra price-war cost per unit the target is ahead of the field median
  serviceGapPenalty: 0.35,       // reputation hit when capacity lags demand
  termCapW: 0.8, termRepW: 40, termAdvW: 60,  // terminal enterprise value weights
  startCash: 60, startCap: 100, startRep: 0.5,

  // ---------- labor (2026-09-10) ----------
  // Why this exists: before it, `served = min(demand, cap)` bound on capacity in 97% of firm-seasons,
  // so share-of-appeal (fit to a segment, and the crowd fighting you for it) never reached revenue and
  // capacity was free money with no interior optimum. Labor is the gate that makes built capacity cost
  // something every season you keep it. The design mirrors the ranch game's O-gate in LABOR_AND_SPEED_SPEC.md:
  // one control, three settings, a one-season hiring lag (the Penrose effect), payroll charged forever.
  // Real-world anchor: seasonal crew and staff housing, not lift count, is what actually caps a US resort's
  // throughput, which is why patrol and lift-op staffing became the industry's binding constraint.
  startStaff: 100,                 // crew on hand at season 0, matched to startCap so nobody starts short
  STAFF_PER_CAP: 1.0,              // crew needed per unit of capacity to actually run it
  LODGE_STAFF_MULT: 1.15,          // a resort that built lodging needs more crew to run the same mountain
  STAFF_PER_HIRE: 9,               // crew added per hire step; the control is hire 0, 1 or 2
  STAFF_WAGE: 0.05,                // payroll per unit of crew per season, charged whether or not it is needed
  STAFF_K: 1.35,                   // understaffing bites superlinearly: usable = cap * utilization^K
  HIRE_MAX: 2,                     // hire steps per season
  OPS_CONVEX: 0.25,                // convex penalty on pushing the capacity dial above its base of 8
  UNDERSTAFF_REP: 0.06,            // reputation hit per season spent visibly understaffed
  baseYield: 0.46,                            // revenue per served skier-day (window base; pass mix scales it)
  // --- 3-facet position anchors (fixed geometry, not tuner knobs: these define what the axes MEAN) ---
  POS_CORE: 0.874, POS_MAIN: 0.276,          // terrain axis anchors (mainstream <-> expert)
  COMFORT_CORE: 0.55, COMFORT_MAIN: 0.25,    // comfort axis anchors (basic <-> full-amenity). No separate
                                  // multiplicative lodge penalty is layered on top of these (see fitTo): the
                                  // GEOMETRIC gate (comfort capped at LODGE_GATE_MAX pre-lodge) already costs an
                                  // ungated firm real 3-facet distance to either anchor. A terrain purist can still
                                  // contest Core demand on terrain fit alone; it just never closes the comfort gap.
  PRICE_CORE: 0.75, PRICE_MAIN: 0.25,        // priceAccess axis anchors (budget <-> premium)
  TERRAIN_REVERT_RATE: 0.06547773636877537,      // natural pull toward Mainstream on the terrain axis absent upkeep spend: unmaintained
                                  // expert terrain gets groomed back down. This is the ONLY way a firm moves toward
                                  // Mainstream (addRuns is a one-directional up-lever, per the real-world lever); it also
                                  // means holding the Core extreme costs continuous upkeep, not a one-time march.
  COMFORT_REVERT_RATE: 0.03750592366792262,      // same idea, milder: comfort SERVICE quality drifts toward basic without upkeep spend
                                  // even though a built lodge (the capital asset / capability gate) never un-builds.
  MATURE_COMFORT_RATE: 0.025,     // maturing market (change 4): Day-Trip Feeder's comfort-need creeps up each
                                  // season (v2's analog of the old 2-segment "Mainstream" anchor); an ungated
                                  // (no-lodging) firm's fit to it quietly erodes as the market matures, while a
                                  // lodged (gated) firm's fit is untouched by the creep
  PASSWAR_RATE: 0.028,             // pass-war squeeze (5-segment lifecycle item 3): extra Day-Trip Feeder mass
                                  // pulled out per season past season 2, scaled by env.growthScale, mirroring
                                  // punitive single-day walk-up pricing forcing feeder skiers to convert or churn
  BEGINNER_CONVERT_RATE: 0.30,     // beginner-conversion funnel (6-segment extension): fraction of each
                                  // season's Beginner raw mass that graduates into Day-Trip/Destination Family
                                  // that same season (see segMassShares); the rest is the ~83%-dropout churn
                                  // the memo cites, which this engine represents as mass simply not appearing
                                  // anywhere else (out of the sport), not as an explicit "churned" pool.
  // --- strategic bets (2026-07-17 engine wave): 5 named, purchasable, one-time commitments. Costs
  // grounded in the old advTypes bet menu (design-ideas/TWO-GAME-AUDIT.md section 2). ---
  EVENTS_DROUGHT_MULT: 2.05,       // Summer Events revenue multiplier in a drought season (the weather-risk payoff)
  EVENTS_POWDER_MULT: 0.55,        // Summer Events revenue multiplier in a powder season (opportunity cost of the hedge)
  SNOWMAKING_HEDGE: 0.55,          // Snowmaking bet: dampens BOTH the revenue-yield weather swing (effSnow) and the
                                  // drought demand dip below, symmetric insurance not a jackpot, matching the old
                                  // "cuts drought exposure, trims powder-year upside" framing.
  DROUGHT_DEMAND_PEN: 0.16,        // in a drought, weather-exposed (low-passMix) firms lose this much appeal/demand
                                  // (not just yield) unless Snowmaking dampens it; this is what makes a hedge holder's
                                  // SALES pulse visibly hold while unhedged rivals shrink (mission item 1's board test).
  MEGAPASS_PULL: 0.11,             // Join a Mega-Pass: instant pull toward the Mainstream terrain/price anchors
  MEGAPASS_PRICE_DILUTE: 0.55,     // fraction of the firm's OWN price-lever target overridden by the pass-hub's
                                  // mainstream price anchor once joined (dilutes pricing control)
  MEGAPASS_SPILLOVER: 0.07,        // appeal bonus to DESTFAM/DAYTRIP (the mainstream segments) once joined
  MEGAPASS_WIDTH_BONUS: 0.025,     // permanent catchment-width bonus (wide reach) once joined
  EXCLUSIVITY_PULL: 0.15,          // Skier-Only Exclusivity: pull toward the Core terrain/price extreme
  EXCLUSIVITY_CORE_BOOST: 0.75,   // raised 2026-09-10: at 0.28 the sever cost far outweighed the Core gain, so Alta went bankrupt in 65% of games and no student would ever take this bet    // CORE-segment appeal/fit boost (binds Core tightly)
  EXCLUSIVITY_SEVER: 0.05,         // DESTFAM appeal multiplier once bought: near-zero, the severed spillover channel
  VALUESBRAND_PULL: 0.10,          // Values Brand: milder pull toward Core than Exclusivity (two-sided, not absolute)
  VALUESBRAND_CORE_BOOST: 0.16,    // CORE-segment appeal/fit boost
  VALUESBRAND_REPEL: 0.30,         // DESTFAM + DAYTRIP appeal penalty (actively repels some Mainstream, partial not severed)
  TWOSIDED_DWELL_BOOST: 1,         // Exclusivity/Values Brand (two-sided bets) grow the dwell/ring counter faster per still-season
  COST_REDESIGN_SAVING: 3.2,       // Cost Redesign: flat running-cost cut per season, no demand pull
  COSTREDESIGN_DWELL_RETAIN: 0.5,  // Cost Redesign: dwell/ring count decays by half on a real move instead of resetting
                                  // to zero (reinforces ring durability), rather than boosting build speed
  WARCOST_CAP_SHRINK_THRESHOLD: 5, // a season's price-war cost above this triggers a capacity contraction (conceding
                                  // share under margin pressure) unless the firm holds Cost Redesign. Raised from an
                                  // initial 3 after hand-tuning showed the lower threshold fired often enough (on the
                                  // SAME per-game seed that also drives the snow draw) to blow up G4's snow-luck
                                  // variance measure - a seed-correlated combat outcome masquerading as "snow luck."
  WARCOST_CAP_SHRINK: 2,           // capacity units lost per triggering season; cut from an initial 4 for the same reason.
  CAP_GROWTH_MULT: 1.7,            // sphere-size widen (mission item 3): multiplier on (opsCost-8) per season, raised
                                  // from the old flat 1.5. NOTE: hand-tuning found this economy is sharply
                                  // capacity-bound (bigger cap -> more servable demand -> more revenue -> more cash ->
                                  // more price-war leverage, a snowball), so the recommended ~2x-swing multiplier
                                  // (~2.4-2.5) made NETWORK a 99% runaway the instant it crossed its own
                                  // capacity-vs-demand threshold; 1.7 is the highest value that still clears G1a/G4/G7
                                  // after a real multi-round tuning pass (see HANDOFF-SPATIAL-BUILD.md). It widens the
                                  // visible swing from ~1.24x to ~1.5x max-aggressive-vs-max-lean, real but short of
                                  // the section-7 audit's literal "roughly 2x" ask - flagged as an open deviation.
  // --- movement / lever tuning surface ---
  MOVE_BASE: 0.24592997315339743,               // base per-season movement budget (distance cap before imperfection scales it down)
  MOVE_RATE: 31.95584272244014,                // $ friction per unit of REALIZED 3D distance per 100 capacity (size slows you)
  RUNS_RATE: 0.03143273157114163,               // $ spent on Add Runs -> terrain intended delta
  LODGE_RATE: 0.019036456593312323,              // $ spent on Build Lodging -> comfort intended delta
  PRICE_MOMENTUM: 0.23084068885073067,           // price dials -> priceAccess intended delta (fraction of the gap closed per season)
  EVENTS_PULL: 0.05,              // $ on Summer Events -> pulls terrain/comfort toward the middle ground
  // Rescaled 2026-09-10 from 1.106. Summer-event revenue is demand-independent by design, so when the
  // skier market was repriced downward it became the only income nobody could compete for, and VOLUME
  // ran away with 65% of games. Scaled roughly with the market so the hedge stays a hedge.
  EVENTS_REV: 0.25,                              // $ on Summer Events -> smoothed off-season revenue (weather- and demand-independent)
  EVENTS_SAT: 6,                  // saturation point for the events revenue curve
  MKT_WIDTH_RATE: 0.0049467995474115015,          // $ on Marketing -> catchment-width bonus this season (widens capture, no position shift)
  RUNS_INFRA_THRESHOLD: 6,        // sustained Add Runs spend needed to hold the terrain reach gate open toward 1.0
  GATE_CLOSE_RATE: 0.0598,        // terrain reach gate closes this much per season once Add Runs spend lapses
  STRANDED_PEN: 0.057,            // appeal multiplier hit while stranded outside a closing terrain gate
  LODGE_GATE_MAX: 0.35,           // comfort ceiling until Build Lodging is bought at least once (the capability GATE);
                                  // this alone is the "unreachable" mechanic (mission item 2) via geometric distance.
  // --- imperfect movement (mission item 3): realized = intended * fraction ----
  IMPERFECT_BASE: 0.21483530743280427,
  IMPERFECT_DEMAND_W: 0.43235604781657455,       // demand mass near the target region HELPS the move land
  IMPERFECT_CROWD_W: 0.3646661676466465,        // rival crowding (weighted by their fit to that region) HURTS it
  IMPERFECT_DIST_W: 0.30574381456244737,         // a long reach this season HURTS it
  SEG_SIGMA: 0.3825108903227374,                // segment positional tolerance in 3-facet space (3-axis Euclidean)
  // --- transient-advantage mechanics (mission item 4) ---
  TRACKOUT_EPS: 0.02,             // a season's realized 3D displacement below this counts as "standing still"
  TRACKOUT_RATE: 0.08891760520171374,            // per still-season, appeal penalty growth once the grace period lapses
  TRACKOUT_MAXPEN: 0.412551959475968,          // cap on the track-out penalty (bounded punishment, G3 hygiene)
  SETTLE_SEASONS: 2,              // still-seasons needed to count as "settled" (earns exclusion territory)
  EXCL_RADIUS: 0.0514,            // exclusion territory radius (terrain axis) for a settled Core-extreme camper
  EXCL_PEN: 0.150,                // exclusion appeal penalty on rivals inside the radius
  // --- reputation / demand-side mechanics carried over unchanged from the pre-spatial tiers ---
  scarcityCapThreshold: 85, scarcityYield: 0.15, scarcityRep: 0.02,
  walletYield: 0.006, trustRep: 0.010,
  hedgePassMix: 0.65, hedgeStrength: 0.30,
};

// per-archetype starting 3-facet position [terrain, comfort, priceAccess]: so archetypes aren't all stacked at center.
const POS_SEED3 = {
  RENEWER:  [0.55, 0.40, 0.45],
  FORTRESS: [0.60, 0.30, 0.55],
  VOLUME:   [0.50, 0.45, 0.40],
  PREMIUM:  [0.65, 0.35, 0.55],
  NETWORK:  [0.45, 0.45, 0.45],
  COST:     [0.35, 0.25, 0.30],
  COAST:    [0.55, 0.35, 0.45],
  // Every student seat starts here, identically. Steven's call 2026-09-10: with teams claiming seats,
  // an asymmetric start means somebody draws a losing mountain through no fault of their own. The six
  // archetypes above survive as the AI rivals and as debrief colour, not as student handicaps.
  NEUTRAL:  [0.50, 0.40, 0.45],
};

// The classroom field. Always ten firms, whether four teams turn up or eight, so the economics do not
// shift with attendance. Up to eight student seats, all identical, each named by its own team. The two
// permanent AI rivals are the real industry story this week teaches: the mega-pass consolidator against
// the committed purist. Unclaimed student seats are run by the same NEUTRAL policy the bots use.
const TEAM_SEATS = 8;
const RIVALS = [
  { arch: 'NETWORK',  name: 'Vail', note: 'the mega-pass consolidator: buys reach, dilutes its own pricing power' },
  { arch: 'FORTRESS', name: 'Alta', note: 'the committed purist: holds the Core corner and refuses the mainstream' },
];
function classroomField() {
  return Array(TEAM_SEATS).fill('NEUTRAL').concat(RIVALS.map(r => r.arch));
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function dist3(a, b) { return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); }

// ---------- strategic bets (2026-07-17 engine wave) ----------
// Five named, discrete, one-time purchasable commitments, available to the player seat and used by
// AI policies where natural (see decide()). Each sets a boolean on r.bets (persistent board state the
// UI reads) and its mechanics are wired through intendedDelta/spatialMods/the appeal loop/the profit
// loop below. Costs are grounded in the old advTypes bet menu (design-ideas/TWO-GAME-AUDIT.md section 2).
const BETS = {
  snowmaking:   { cost: 16, label: 'Snowmaking' },        // climate hedge: dampens weather exposure both ways
  megapass:     { cost: 11, label: 'Join a Mega-Pass' },  // instant wide reach, dilutes pricing control
  exclusivity:  { cost: 11, label: 'Skier-Only Exclusivity' }, // two-sided: binds Core, severs Mainstream spillover
  costRedesign: { cost: 10, label: 'Cost Redesign' },     // no demand pull; cuts running cost, holds capacity in a price war
  valuesBrand:  { cost: 13, label: 'Values Brand' },      // two-sided: binds Core, repels some Mainstream
};

// ---------- 6-segment lifecycle (2026-07-16/17, design-ideas/SKI-INDUSTRY-GROUNDING.md) ----------
// Replaces the hardcoded Core/Mainstream 2-segment split with 6 map segments, need vectors and
// initial masses taken directly from the memo's segment table. Summer/Off-Season stays the
// existing summerEvents capability gate (EVENTS_REV/EVENTS_PULL), NOT a map segment, per the
// memo's own framing ("a genuinely new revenue axis, not a repositioning").
// The memo scores facet 3 as price SENSITIVITY (`sens`, 0=insensitive..1=very sensitive); this
// engine's third axis is price POSITION (0=budget..1=premium). Conversion used throughout:
// priceAccess = 1 - sens (a price-sensitive segment sits at the budget end of the position axis,
// a price-insensitive segment sits at the premium end) - direction-preserving, not re-derived.
// `sens` is also reused (via formula, not separately invented) to derive each segment's price and
// pass-mix revenue weights below, so a segment's price-appeal behavior stays coherent with its
// stated sensitivity.
// 2026-07-17: added PARKPIPE (the memo's optional 6th, section 4) and BEGINNER (section 1's
// learn-to-ski row + the beginner-funnel dynamic from section 4's cheap-adds list). The original
// 4 segments' massTraj values were scaled down (~x0.92, same relative shape) so the 6-segment
// season-0 nominal masses sum to ~1 again - the RUNTIME shares always sum to 1 regardless (see
// segMassShares's renormalization), this rescale is purely so the table below reads honestly as
// "the masses," not a code requirement.
const SEGMENTS = [
  { id: 'CORE',    name: 'Core/Expert',        sens: 0.30, vec: [0.90, 0.20, 1 - 0.30],
    massTraj: [0.313, 0.276, 0.239, 0.212, 0.184, 0.166] },   // shrinking share, aging in place
  { id: 'DESTFAM', name: 'Destination Family', sens: 0.15, vec: [0.30, 0.85, 1 - 0.15],
    massTraj: [0.230, 0.249, 0.267, 0.286, 0.304, 0.313] },   // grows steadily, price-insensitive (vacation pre-commit)
  { id: 'DAYTRIP', name: 'Day-Trip Feeder',    sens: 0.80, vec: [0.50, 0.15, 1 - 0.80],
    massTraj: [0.258, 0.221, 0.184, 0.157, 0.129, 0.111] },   // declines every season: the mega-pass squeeze target
  { id: 'LUXURY',  name: 'Luxury/Amenity',     sens: 0.05, vec: [0.20, 0.95, 1 - 0.05],
    massTraj: [0.074, 0.074, 0.074, 0.074, 0.074, 0.074] },   // small, nearly recession/climate-proof, flat
  { id: 'PARKPIPE', name: 'Park & Pipe Youth', sens: 0.70, vec: [0.75, 0.25, 1 - 0.70],
    massTraj: [0.055, 0.054, 0.053, 0.052, 0.052, 0.051] },   // small, culturally load-bearing, visit-share flat
  { id: 'BEGINNER', name: 'Beginner/Learn-to-Ski', sens: 0.75, vec: [0.15, 0.45, 1 - 0.75],
    massTraj: [0.070, 0.065, 0.060, 0.055, 0.050, 0.045] },   // shrinking funnel; CONVERT_RATE below layers
                                                               // the graduate-out-of-the-segment dynamic on top
];
// segVecAt: a segment's need vector at season s. Only DAYTRIP's comfort need creeps up over the
// game (maturing-market dynamic, same MATURE_COMFORT_RATE knob the old 2-segment engine applied to
// "Mainstream" - DAYTRIP is this engine's closest analog to that segment: the budget, no-lodging
// crowd gradually expecting more amenities as the industry matures). CORE/DESTFAM/LUXURY anchors
// are left static; they already sit at meaningfully separated, non-adjacent points in the space.
function segVecAt(seg, s) {
  if (seg.id === 'DAYTRIP') return [seg.vec[0], seg.vec[1] + s * CONFIG.MATURE_COMFORT_RATE, seg.vec[2]];
  return seg.vec;
}
// segMassShares: keyframed lifecycle (mission item 2). Each segment's raw weight this season is its
// season-0 mass plus (season-s keyframe minus season-0) SCALED by chasmScale (the existing env knob
// that already governed how fast the old core/mainstream chasm shift ran) - so a low-chasmScale game
// plays a slower, flatter lifecycle and a high-chasmScale game plays a faster, more dramatic one.
// Raw weights are then renormalized to sum to 1: this is what makes TOTAL market mass stay flat
// (the design spine) while composition churns underneath - the plateau is structural, not tuned.
// The pass-war squeeze (mission item 3's one cheap shock) subtracts extra DAYTRIP mass late-game,
// scaled by growthScale (the existing env knob for how aggressive/fast-growing a game's world is),
// wired in BEFORE the renormalization so the pulled mass redistributes across the other segments
// automatically, mirroring how real single-day walkup pricing pushed feeder skiers toward either
// churning out or converting to a pass-loyal (DESTFAM-ward) segment.
// Beginner-to-feeder conversion funnel (2026-07-17 6-segment extension, mission item): a fixed
// fraction of each season's Beginner raw mass "graduates" out into Day-Trip Feeder and Destination
// Family (mostly Day-Trip - a beginner who sticks with the sport becomes a value-conscious repeat
// visitor before ever becoming a destination-vacation buyer), SAME season. This engine has no
// persisted cross-season segment state (each season's masses are recomputed fresh from massTraj +
// env), and a season here already compresses real years, so a same-season transfer is the simplest
// honest version, not a lag and not a loyalty mechanic: conversion mass flows to the destination
// segments regardless of which firm actually served the Beginner demand this season, per the
// mission's explicit instruction not to build loyalty-tracking.
function segMassShares(s, env) {
  const chasmScale = env.chasmScale;
  const raw = {};
  for (const seg of SEGMENTS) {
    const w0 = seg.massTraj[0], ws = seg.massTraj[s];
    raw[seg.id] = Math.max(0.01, w0 + (ws - w0) * chasmScale);
  }
  const passWarBite = Math.max(0, s - 2) * CONFIG.PASSWAR_RATE * env.growthScale;
  raw.DAYTRIP = Math.max(0.01, raw.DAYTRIP - passWarBite);
  const convertOut = raw.BEGINNER * CONFIG.BEGINNER_CONVERT_RATE;
  raw.BEGINNER = Math.max(0.01, raw.BEGINNER - convertOut);
  raw.DAYTRIP += convertOut * 0.65;
  raw.DESTFAM += convertOut * 0.35;
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const shares = {};
  for (const seg of SEGMENTS) shares[seg.id] = raw[seg.id] / sum;
  return { shares, passWarBite, convertOut };
}

// ---------- typed competitive moves + AMC (Chen 1996), mirrored from the prototype ----------
// 2026-07-17 (Steven, live): Undercut and Ally CUT from the game entirely - their substance is
// pricing behavior, which the price levers already own as a visible board axis; an appeal-shuffling
// side move duplicating that was off-design. Poach, Signal, Counter, and Stand Pat ("none") stay.
const MOVES = {
  none:     { cost: 0, kind: 'defensive' },
  poach:    { cost: 9, kind: 'tactical' },
  counter:  { cost: 7, kind: 'defensive' },
  signal:   { cost: 3, kind: 'strategic' },
};
const RESPONSE_DELAY = { tactical: 1, strategic: 2, defensive: 99 };
const needsTarget = m => m === 'poach' || m === 'signal';

// segProfile reads the TERRAIN axis only (r.pos[0]): keeps the {core, main} return shape so
// commonality()/amcScore()/attackedSeg() (the AMC awareness-motivation-capability subsystem) work unchanged.
function segProfile(r) {
  const core = clamp(1 - Math.abs(r.pos[0] - CONFIG.POS_CORE) / (CONFIG.POS_CORE - CONFIG.POS_MAIN), 0.05, 0.95);
  return { core, main: 1 - core };
}
function commonality(A, T) { const a = segProfile(A), b = segProfile(T); return Math.min(a.core, b.core) + Math.min(a.main, b.main); }
function resourceSim(A, T) {
  const posSim = 1 - Math.min(1, dist3(A.pos, T.pos));
  const lodgeSim = A.lodgeBuilt === T.lodgeBuilt ? 1 : 0.5;   // proxy for "similar capability build" without discrete bets
  return 0.5 * lodgeSim + 0.5 * posSim;
}
function attackedSeg(move, T) { if (move === 'poach') { const p = segProfile(T); return p.core >= p.main ? 'core' : 'main'; } return 'main'; }
function amcScore(A, T, move) {
  const kind = MOVES[move].kind;
  const aware = (kind === 'defensive') ? 0 : 0.9;
  const comm = commonality(A, T);
  const rsim = resourceSim(A, T);
  const motivation = Math.min(1, comm * (0.55 + 0.45 * rsim));
  const seg = attackedSeg(move, T);
  const dep = (seg === 'core' ? segProfile(T).core : segProfile(T).main);
  const resources = Math.min(1, Math.max(0, (T.cash - CONFIG.retaliateFloor * 0.4) / CONFIG.retaliateFloor));
  const power = T.cash / (A.cash + T.cash + 1e-9);
  const capability = Math.min(1, 0.45 * dep + 0.35 * resources + 0.20 * Math.min(1, power * 1.5));
  const likely = aware * motivation * capability;
  return { likely, kind, seg };
}
// each archetype's competitive move this season (targets the current leader unless retaliating)
// 2026-07-17: remapped off the retired Undercut/Ally onto the surviving Poach/Signal/Counter/none
// grammar, keeping each archetype's competitive personality coherent. VOLUME and FORTRESS both used
// Undercut (a tactical move, RESPONSE_DELAY 1) alternating with Signal (strategic, delay 2); Poach is
// the only remaining tactical move, so it's a direct 1:1 swap that preserves the alternation rhythm.
// NETWORK used Ally (strategic, delay 2, no single target - rallied the weakest seat against the
// leader, at cost 5, a real recurring drag on NETWORK's own cash). A first pass tried a pure Signal
// remap (cost 3, cheapest surviving option): this UNDER-taxed NETWORK relative to its old Ally cost
// and it ran away to a 76-77% win share once that drag disappeared (hand-diagnosed via the gate
// harness - Ally's cost, not its rubber-band effect on OTHER leaders, turned out to be load-bearing
// for NETWORK's own balance). Landed on alternating Counter (cost 7, a real recurring tax closer to
// Ally's own cost, still no direct attack) and Signal (cost 3, cheap pressure on the current leader)
// by season parity - keeps NETWORK's "coalition-minded, doesn't start price fights" flavor while
// restoring a cost drag in the same ballpark as the retired move.
function aiMoveNode(r, li, s) {
  // spatial-character move scripts (unchanged from the 1D redesign): cheap/defensive for the thin-margin
  // Chaser/Drafter-family archetypes, dig-in for the entrenched ones.
  const A = r.arch, isLead = r.i === li; let m = 'none', t = null;
  if (isLead) m = 'counter';
  else if (A === 'VOLUME') { m = (s <= 1 ? 'none' : (s % 2 ? 'signal' : 'poach')); t = li; }
  else if (A === 'RENEWER') { m = 'signal'; t = li; }
  else if (A === 'NETWORK') { m = (s % 2 ? 'signal' : 'counter'); t = li; }
  else if (A === 'PREMIUM') { m = 'counter'; t = li; }
  else if (A === 'FORTRESS') { m = (s < 2 ? 'counter' : (s % 2 ? 'signal' : 'poach')); t = li; }
  else if (A === 'COST') { m = (s % 2 ? 'signal' : 'none'); t = li; }
  return { r, m, t };
}

// ---------- spatial redesign v2: gates, movement levers, imperfect resolution ----------
function spatialMods(r) {
  // terrain reach gate: sustained Add Runs spend holds it open toward the expert extreme; it lapses otherwise.
  if (r._reachHi == null) r._reachHi = 0.75;
  if ((r._spendRuns || 0) >= CONFIG.RUNS_INFRA_THRESHOLD) r._reachHi = Math.max(r._reachHi, 1.0);
  else r._reachHi = Math.max(0.75, r._reachHi - CONFIG.GATE_CLOSE_RATE);
  const mods = { reachHi: r._reachHi, moveBonus: 0, moveDiscount: 0, widthBonus: 0 };
  // Discounter-style low priceAccess positioning buys nimbleness (low overhead moves cheap).
  if (r.pos[2] < 0.35) mods.moveDiscount = Math.min(0.35, (0.35 - r.pos[2]) / 0.35 * 0.35);
  // Marketing widens catchment this season only; a built lodge keeps a small permanent spillover width;
  // Mega-Pass adds a permanent wide-reach bonus on top (instant reach, per the bet's own framing).
  mods.widthBonus = Math.min(0.10, (r._spendMkt || 0) * CONFIG.MKT_WIDTH_RATE) + (r.lodgeBuilt ? 0.03 : 0)
    + ((r.bets && r.bets.megapass) ? CONFIG.MEGAPASS_WIDTH_BONUS : 0);
  return mods;
}
// lever spend -> intended facet delta (mission item 2/3). Position moves ONLY through this function.
// Strategic bets (mission item 2) also pull position: Mega-Pass toward Mainstream, Exclusivity/Values
// Brand toward Core (Exclusivity harder, per its "pulls hard" framing vs Values Brand's milder pull).
function intendedDelta(r) {
  const revert0 = (CONFIG.POS_MAIN - r.pos[0]) * CONFIG.TERRAIN_REVERT_RATE;      // groomed-back-down pull
  const revert1 = (CONFIG.COMFORT_MAIN - r.pos[1]) * CONFIG.COMFORT_REVERT_RATE;  // service-quality-drifts-down pull
  const d0 = (r._spendRuns || 0) * CONFIG.RUNS_RATE + revert0;
  const d1 = (r._spendLodging || 0) * CONFIG.LODGE_RATE + revert1;
  const eventsOn = (r._spendEvents || 0) > 0;
  const d0b = eventsOn ? (0.5 - r.pos[0]) * CONFIG.EVENTS_PULL : 0;
  const d1b = eventsOn ? (0.5 - r.pos[1]) * CONFIG.EVENTS_PULL * 0.8 : 0;
  const bets = r.bets || {};
  const megaPull = bets.megapass ? CONFIG.MEGAPASS_PULL : 0;
  const corePull = (bets.exclusivity ? CONFIG.EXCLUSIVITY_PULL : 0) + (bets.valuesBrand ? CONFIG.VALUESBRAND_PULL : 0);
  const d0c = megaPull * (CONFIG.POS_MAIN - r.pos[0]) + corePull * (CONFIG.POS_CORE - r.pos[0]);
  const d2c = megaPull * (CONFIG.PRICE_MAIN - r.pos[2]) + corePull * (CONFIG.PRICE_CORE - r.pos[2]);
  const priceTargetRaw = clamp(r.dayPassPrice * 0.65 + r.lodgingRate * 0.35, 0, 1);
  // Mega-Pass dilutes pricing control: the firm's own price levers only partially set its priceAccess
  // target once joined, the rest is pulled toward the pass hub's mainstream price anchor.
  const priceTarget = bets.megapass
    ? priceTargetRaw * (1 - CONFIG.MEGAPASS_PRICE_DILUTE) + CONFIG.PRICE_MAIN * CONFIG.MEGAPASS_PRICE_DILUTE
    : priceTargetRaw;
  const d2 = (priceTarget - r.pos[2]) * CONFIG.PRICE_MOMENTUM + d2c;
  return [d0 + d0b + d0c, d1 + d1b, d2];
}
// imperfect movement resolver (mission item 3): realized displacement = intended, scaled by demand mass
// near the target region and rival crowding weighted by their own fit to that region.
// `segShares` is the {id: share} map from segMassShares(s, env).shares; demandMass now sums pull from
// all 4 lifecycle segments (generalizes the old 2-anchor Core/Main sum) at their season-s vectors.
// posSnap: every resort's position as it stood BEFORE anyone moved this season. Crowding must be
// judged against where rivals actually were when the decision was made, not against where the ones
// that happened to be earlier in the array have already moved to. Reading live positions here made
// the first seat in the array win 57% of games against identical opponents, because it alone was
// crowded against a fully stale field. This is a sealed simultaneous-commit game; within a season
// nobody sees anybody else's move. See gate G11.
function resolveAxes(r, resorts, segShares, s, mods, posSnap) {
  const delta = intendedDelta(r);
  const rawTarget = [r.pos[0] + delta[0], r.pos[1] + delta[1], r.pos[2] + delta[2]];
  const target = [
    clamp(rawTarget[0], 0.05, mods.reachHi),
    clamp(rawTarget[1], 0, r.lodgeBuilt ? 1.0 : CONFIG.LODGE_GATE_MAX),
    clamp(rawTarget[2], 0, 1),
  ];
  let demandMass = 0;
  for (const seg of SEGMENTS) {
    const anchor = segVecAt(seg, s);
    const d = dist3(target, anchor);
    demandMass += segShares[seg.id] * Math.exp(-(d * d) / (2 * CONFIG.SEG_SIGMA * CONFIG.SEG_SIGMA));
  }
  const dSelf = dist3(r.pos, target);
  let crowdWeight = 0;
  for (const o of resorts) {
    if (o.i === r.i) continue;
    const dRival = dist3(posSnap ? posSnap[o.i] : o.pos, target);
    if (dRival < dSelf) crowdWeight += Math.exp(-(dRival * dRival) / (2 * CONFIG.SEG_SIGMA * CONFIG.SEG_SIGMA));
  }
  const fraction = clamp(CONFIG.IMPERFECT_BASE + demandMass * CONFIG.IMPERFECT_DEMAND_W
                        - crowdWeight * CONFIG.IMPERFECT_CROWD_W - dSelf * CONFIG.IMPERFECT_DIST_W, 0.08, 1);
  const budget = CONFIG.MOVE_BASE + mods.moveBonus;
  const moveDist = Math.min(dSelf, budget) * fraction;
  const dir = dSelf > 1e-9 ? [(target[0]-r.pos[0])/dSelf, (target[1]-r.pos[1])/dSelf, (target[2]-r.pos[2])/dSelf] : [0,0,0];
  const realized = [dir[0]*moveDist, dir[1]*moveDist, dir[2]*moveDist];
  return { target, realized, fraction, demandMass, crowdWeight, dist: dSelf, intended: delta };
}
function fitTo(anchor, r) {
  const dRaw = dist3(r.pos, anchor);
  const dEff = dRaw * (1 - 0.3 * r.rep);   // reputation gives a small amount of positional portability
  const sigma = CONFIG.SEG_SIGMA + r.width;
  return Math.exp(-(dEff * dEff) / (2 * sigma * sigma));
}

// ---------- stage-read diagnosis instrument (mission item 4) ----------
// Derives the hidden TRUE industry stage per season ('growth'|'shakeout'|'mature') from the actual
// segment lifecycle, not a hardcoded season index. Rule: compute each season's total segment-mass
// churn (sum of |mass[s]-mass[s-1]| across all 6 segments, using this game's own env so a fast- or
// slow-chasm world gets its own read); the 2 seasons with the highest churn are 'shakeout' (the
// window where mass visibly moves between segments), everything before that window is 'growth'
// (the market is still expanding into its season-0 shape), everything after is 'mature' (composition
// has settled into its late-game shares). This is keyframe-derived (SEGMENTS[].massTraj drives
// segMassShares, which drives the churn signal) rather than a hardcoded season cutoff, per the mission.
function trueStageArray(env) {
  const churn = [0];
  let prev = segMassShares(0, env).shares;
  for (let s = 1; s < CONFIG.SEASONS; s++) {
    const cur = segMassShares(s, env).shares;
    let c = 0;
    for (const seg of SEGMENTS) c += Math.abs(cur[seg.id] - prev[seg.id]);
    churn.push(c);
    prev = cur;
  }
  const ranked = churn.map((c, i) => [c, i]).slice(1).sort((a, b) => b[0] - a[0]);
  const shakeoutIdx = ranked.slice(0, 2).map(x => x[1]);
  const shakeoutMin = Math.min(...shakeoutIdx), shakeoutMax = Math.max(...shakeoutIdx);
  const stages = [];
  for (let s = 0; s < CONFIG.SEASONS; s++) {
    stages.push(s < shakeoutMin ? 'growth' : (s <= shakeoutMax ? 'shakeout' : 'mature'));
  }
  return stages;
}

// ---------- one game ----------
function envForGame(seed) {
  const r = mulberry32(seed * 2654435761 >>> 0);
  const env = { growthScale: 1 + (r() - 0.5) * 2 * CONFIG.growthSpread,
                chasmScale:  1 + (r() - 0.5) * 2 * CONFIG.chasmSpread,
                inflection: 3 + Math.floor(r() * 3) };
  env.trueStageTrace = trueStageArray(env);
  env.trueStage = s => env.trueStageTrace[s];   // per-season hidden-stage read, for the UI's diagnosis instrument
  return env;
}

// ---------- game state: init / step / finalize (2026-09-10 multiplayer refactor) ----------
// simulateGame() used to be one monolithic function with the AI's decide() call buried inside its
// season loop, which made it impossible to resolve a season from decisions supplied from outside.
// It is now three pieces. The season loop body below is UNCHANGED from the single-player version,
// line for line: the only difference is that a seat with a supplied decision uses it instead of
// calling decide(). An empty decisions map reproduces the old behaviour exactly, which is what the
// whole gate harness relies on and what powder/parity-dump.js proves.

function initGameState(assignment, seed, env) {
  env = env || envForGame(seed);
  // some call sites (g2Test/computeGates' neutralEnv, worldFlipTest) pass a bare {growthScale,chasmScale}
  // env without going through envForGame; backfill the stage-read trace so trueStage() always resolves.
  if (!env.trueStageTrace) { env.trueStageTrace = trueStageArray(env); env.trueStage = s => env.trueStageTrace[s]; }
  const INFL = env.inflection == null ? CONFIG.INFLECTION : env.inflection;
  const rng = mulberry32(seed);
  const trng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const resorts = assignment.map((arch, i) => ({
    i, arch, cash: CONFIG.startCash, cap: CONFIG.startCap, rep: CONFIG.startRep,
    staff: CONFIG.startStaff, _hire: 0, _pendingHire: 0, _util: 1, _staffReq: 0, _payroll: 0,
    pos: POS_SEED3[arch] ? [...POS_SEED3[arch]] : [0.5, 0.5, 0.5],
    width: 0, lodgeBuilt: false, _reachHi: 0.75, _stillSeasons: 0, _trackOutPen: 0, _dwell: 0,
    bets: { snowmaking: false, megapass: false, exclusivity: false, costRedesign: false, valuesBrand: false },
    _buyBet: null, _betSpend: 0,
    dayPassPrice: 0.5, lodgingRate: 0.5, passMix: 0.5, price: 1.0, profit: 0,
    stageBias: (mulberry32((((seed * 131) ^ (i * 977)) >>> 0))() - 0.5) * 0.5,
    edges: [], renewSeasons: [],
    servedTotal: 0, revTotal: 0, seasonServed: [], seasonProfit: [], capSum: 0,
    built: { runs: 0, lodging: 0, events: 0, marketing: 0 },
  }));
  let snow = 'normal';
  const responseQueue = [];
  let prevShares = null;                 // for the segment trend trace (mission item 3)
  const segTrace = [];

  return { resorts, env, INFL, rng, trng, snow, responseQueue, prevShares, segTrace, season: 0 };
}

// Apply an externally-supplied decision to a seat. This is the contract a client payload must
// satisfy, and it mirrors decide()'s own header reset field for field: every value decide() would
// have set is set here, so the economics downstream cannot tell a human seat from an AI one.
// A missing field is a hard error rather than a silent carry-over of last season's value.
function applyDecision(r, d) {
  const need = (v, name) => {
    if (v == null || Number.isNaN(v)) throw new Error('decision for seat ' + r.i + ' is missing ' + name);
    return v;
  };
  const spend = d.spend || {};
  const price = d.price || {};
  r._opsCost      = need(d.capacityDial, 'capacityDial');
  r._spendRuns    = need(spend.runs, 'spend.runs');
  r._spendLodging = need(spend.lodging, 'spend.lodging');
  r._spendEvents  = need(spend.events, 'spend.events');
  r._spendMkt     = need(spend.marketing, 'spend.marketing');
  r.dayPassPrice  = need(price.day, 'price.day');
  r.lodgingRate   = need(price.lodge, 'price.lodge');
  r._buyBet       = d.buyBet || null;   // optional: at most one one-time bet, null is a valid answer
  r._betSpend     = 0;                  // charged by the bet block below if the bet is new
  // labor: hire 0, 1 or 2 crews. Queued, not immediate; it starts work next season.
  r._hire         = Math.max(0, Math.min(CONFIG.HIRE_MAX, Math.round(d.hire || 0)));
  r._pendingHire  = r._hire;
  // decide()'s own last statement, and it applies to every archetype, so it has to apply here too.
  // Leaving it out meant a human seat paid the running cost of a high capacity dial every season and
  // never received the capacity, which made the dial look monotonically bad in testing.
  // Deliberately NOT copied: RENEWER's `r.cap = Math.min(r.cap, 79)` clamp, which is that one
  // archetype's policy quirk rather than part of the shared rules.
  r.cap += (r._opsCost - 8) * CONFIG.CAP_GROWTH_MULT;
}

// Resolve ONE season for the whole field. `decisionsBySeat` maps seat index -> decision payload;
// any seat absent from the map is resolved by the scripted AI exactly as before.
function stepSeason(st, decisionsBySeat) {
  const D = decisionsBySeat || {};
  const { resorts, env, INFL, rng, trng, responseQueue, segTrace } = st;
  let snow = st.snow, prevShares = st.prevShares;
  const s = st.season;
  {
    const inflected = s >= INFL;
    const rs = rng();
    if (rs > CONFIG.snowStay) snow = ['powder', 'normal', 'drought'][Math.floor(rng() * 3)];
    const snowMult = CONFIG.snow[snow];
    const market = CONFIG.MARKET_PER_FIRM * resorts.length * cumGrowth(s, env.growthScale);
    const { shares: segShares, passWarBite, convertOut } = segMassShares(s, env);
    // RENEWER's macro stage-read (the only remaining use of a single scalar "core" signal): CORE's
    // share relative to the two segments RENEWER's OTHER lever (Build Lodging) could chase instead
    // (DESTFAM + LUXURY, the high-comfort segments) - >=0.5 means "Core still outweighs the comfort
    // family," <0.5 means the lifecycle has tipped comfort-ward and it's time to pivot. (An earlier
    // version normalized CORE's share against its OWN min/max keyframe range; that inverted the
    // intended signal, because DAYTRIP's collapse mechanically inflates CORE's post-renormalization
    // share even as CORE's real position in the lifecycle fades, so "wantCore" never flipped false.
    // Comparing against the segments it actually competes with for RENEWER's spend fixes that.)
    const comfortShare = segShares.DESTFAM + segShares.LUXURY;
    const core = segShares.CORE / (segShares.CORE + comfortShare || 1);

    // each resort decides lever spend + prices for this season
    // Hiring lands with a one-season lag: crew hired last season starts work now. That lag is the
    // whole point of the lever. You cannot staff a build the season you decide to build it, so
    // capacity has to be planned a season ahead of the demand you are betting will show up.
    for (const r of resorts) {
      if (r._pendingHire) { r.staff += r._pendingHire * CONFIG.STAFF_PER_HIRE; r._pendingHire = 0; }
    }

    // a seat with a supplied decision uses it; every other seat is decided by the scripted AI,
    // at the same call site, in the same order, drawing from the same RNG sequence as before.
    for (const r of resorts) { if (D[r.i]) applyDecision(r, D[r.i]); else decide(r, s, inflected, core, resorts); }

    // strategic bet purchase (mission item 2): a one-time commitment, applied THIS season so its pull
    // and board effects show up immediately (matches the bets' own "instant" framing, e.g. Mega-Pass).
    // Idempotent: a bet already held is never re-bought or re-charged.
    for (const r of resorts) {
      if (r._buyBet && BETS[r._buyBet] && !r.bets[r._buyBet]) {
        r.bets[r._buyBet] = true;
        r._betSpend = BETS[r._buyBet].cost;
      }
      // explicit severed-channel flag for the UI (mission item 2: "arrow goes dark"), rather than
      // making the port re-derive it from r.bets.exclusivity every render.
      r._severedSeg = r.bets.exclusivity ? 'DESTFAM' : null;
    }

    // move resolver: levers -> intended delta -> imperfect realization (change 2/3)
    // Positions are frozen before anyone moves, so every resort is judged against the same board.
    const posSnap = resorts.map(x => [...x.pos]);
    for (const r of resorts) {
      const mods = spatialMods(r);
      r._stranded = false;
      if (r.pos[0] > mods.reachHi) { r.pos[0] = Math.max(mods.reachHi, r.pos[0] - CONFIG.GATE_CLOSE_RATE); r._stranded = true; }
      const res = resolveAxes(r, resorts, segShares, s, mods, posSnap);
      r.pos = [clamp(r.pos[0]+res.realized[0],0,1), clamp(r.pos[1]+res.realized[1],0,1), clamp(r.pos[2]+res.realized[2],0,1)];
      if ((r._spendLodging || 0) > 0 && !r.lodgeBuilt) r.lodgeBuilt = true;
      const dispMag = Math.sqrt(res.realized[0]**2 + res.realized[1]**2 + res.realized[2]**2);
      r._repoCost = CONFIG.MOVE_RATE * dispMag * (r.cap / 100) * (1 - mods.moveDiscount);
      // track-out decay (change 4): standing still erodes fit; the clock runs faster once the field inflects.
      r._stillSeasons = dispMag < CONFIG.TRACKOUT_EPS ? (r._stillSeasons || 0) + 1 : 0;
      const graceLeft = Math.max(0, r._stillSeasons - 1);
      r._trackOutPen = Math.min(CONFIG.TRACKOUT_MAXPEN, graceLeft * CONFIG.TRACKOUT_RATE * (inflected ? CONFIG.inflectionDecayMult : 1));
      r.renewSeasons.push(dispMag >= CONFIG.TRACKOUT_EPS);
      // dwell tracking (mission item 5): the RING driver, kept coherent with but separate from
      // _stillSeasons (which still drives track-out penalty + exclusion territory, mechanically
      // unchanged). Two-sided bets (Exclusivity/Values Brand) grow rings faster per still-season
      // (a real reason to hold two-sided bets, per the mission). Cost Redesign reinforces ring
      // durability: a real move only halves the ring count instead of zeroing it.
      if (dispMag < CONFIG.TRACKOUT_EPS) {
        const twoSided = !!(r.bets && (r.bets.exclusivity || r.bets.valuesBrand));
        r._dwell = (r._dwell || 0) + 1 + (twoSided ? CONFIG.TWOSIDED_DWELL_BOOST : 0);
      } else {
        r._dwell = (r.bets && r.bets.costRedesign) ? Math.floor((r._dwell || 0) * CONFIG.COSTREDESIGN_DWELL_RETAIN) : 0;
      }
      r.width = mods.widthBonus;
      r.passMix = clamp(0.80 - 0.60 * r.pos[0], 0.15, 0.85);
      r.price = 0.85 + 0.30 * r.pos[2];
      r._intendedDelta = res.intended; r._realizedDelta = res.realized; r._moveFraction = res.fraction;   // trace for the UI ghost/solid arrows
    }

    // competitive dynamics (Chen AMC): typed moves, and each target answers back later if aware+motivated+capable
    const R = CONFIG.raidShift, W = CONFIG.warCost, floor = CONFIG.retaliateFloor;
    resorts.forEach(r => { r._raid = 0; r._raidC = 0; r._warCost = 0; r._freeze = false; r._resist = 0; r._moveCost = 0; });
    const medCash = median(resorts.map(r => r.cash));
    const maxCash = Math.max(...resorts.map(r => r.cash));
    const tiedLead = resorts.filter(r => r.cash === maxCash);
    const leader = tiedLead[Math.floor(trng() * tiedLead.length)];
    const leaderIdx = leader.i;
    const byI = i => resorts.find(x => x.i === i);
    const capableOf = r => r.cash > floor;
    const coreLean = T => T.pos[0] >= 0.5;
    // 2026-07-17: response is always a Poach counter-strike now (Undercut is retired, and Poach is the
    // only remaining targetable tactical move a retaliating firm can throw back).
    const moves = resorts.map(r => {
      const idx = responseQueue.findIndex(q => q.responder === r.i && q.due === s);
      if (idx >= 0) { const q = responseQueue.splice(idx, 1)[0]; return { r, m: 'poach', t: q.against }; }
      return aiMoveNode(r, leaderIdx, s);
    });
    const tgt = mv => mv.t == null ? leader : (byI(mv.t) || leader);
    for (const mv of moves) { mv.r._moveCost = MOVES[mv.m].cost; if (mv.m === 'counter') { mv.r._resist = 0.5; if (coreLean(mv.r)) mv.r._raidC += 0.30 * R; else mv.r._raid += 0.30 * R; } }
    // 2026-07-17: Undercut and Ally (and their price-war-cost math) are retired. Poach is now the ONLY
    // move that carries a war-cost component - re-anchored here (it didn't cost war-cost before) so the
    // WARCOST_CAP_SHRINK mechanic (Cost Redesign's "holds capacity through a price war" identity) still
    // has a live trigger; without this, _warCost would always be 0 post-cut and that whole bet mechanic
    // would go silently dead. See the dated handoff note for the retune this required.
    for (const mv of moves) {
      const A = mv.r;
      if (mv.m === 'poach') {
        const T = tgt(mv); if (!T || T.i === A.i) continue;
        const eff = 0.5 * R * (1 - (T._resist || 0));
        if (coreLean(T)) { A._raidC += eff; T._raidC -= eff; } else { A._raid += eff; T._raid -= eff; }
        if (capableOf(T)) { const gap = Math.max(0, T.cash - medCash); A._warCost += 0.35 * W; T._warCost += 0.45 * W * (1 + gap * CONFIG.leadPenalty); }
      }
      else if (mv.m === 'signal') { const T = tgt(mv); if (!T || T.i === A.i) continue; T._freeze = true; if (capableOf(T)) A.rep = Math.max(0, A.rep - 0.03); }
    }
    // (a 'signal' no longer freezes an advantage build, since bets are retired; it stays a cheap rep-tax play)
    for (const mv of moves) { if (!needsTarget(mv.m)) continue; const A = mv.r, T = tgt(mv); if (!T || T.i === A.i) continue; const amc = amcScore(A, T, mv.m); if (amc.likely > 0.30) responseQueue.push({ responder: T.i, against: A.i, due: s + RESPONSE_DELAY[amc.kind], kind: amc.kind }); }

    // Cost Redesign's board expression (mission item 2): a firm paying real price-war cost this season
    // concedes some capacity (a real-world margin-pressure downsize) UNLESS it holds Cost Redesign, which
    // holds capacity/size through the fight while rivals shrink - directly visible via item 3's sphere size.
    for (const r of resorts) {
      if ((r._warCost || 0) > CONFIG.WARCOST_CAP_SHRINK_THRESHOLD && !(r.bets && r.bets.costRedesign)) {
        r.cap = Math.max(CONFIG.startCap * 0.5, r.cap - CONFIG.WARCOST_CAP_SHRINK);
      }
    }

    // appeal per segment: multiplicative 3-facet distance kernel (generalizes the 1D fit kernel) over
    // all 4 lifecycle segments (mission item 2). Each segment's price/pass-mix revenue weight is
    // DERIVED from its price-sensitivity `sens` (not hand-tuned per segment): more price-sensitive
    // segments discount a resort harder for high price and reward high passMix (pass-value) more; less
    // sensitive segments barely react to either. This generalizes the old hand-tuned Core(1.2,-0.15) /
    // Mainstream(1.6,+0.35) weights the same way the old numbers were shaped, now for 4 segments.
    const appealBySeg = {}; SEGMENTS.forEach(seg => appealBySeg[seg.id] = []);
    for (const r of resorts) {
      const base = 1 + r.rep * 0.8;
      const bets = r.bets || {};
      // drought demand hedge (mission item 1): a bad-snow season doesn't just cut revenue YIELD, it cuts
      // real DEMAND for weather-exposed (low-passMix) firms, unless Snowmaking dampens it. This is what
      // makes a hedged firm's served-demand ("sales pulse", item 3) visibly HOLD in a drought while
      // unhedged rivals shrink, rather than only showing up as a revenue-per-skier number.
      const droughtDemandMult = (snow === 'drought')
        ? (1 - CONFIG.DROUGHT_DEMAND_PEN * (1 - r.passMix) * (bets.snowmaking ? (1 - CONFIG.SNOWMAKING_HEDGE) : 1))
        : 1;
      for (const seg of SEGMENTS) {
        const priceW = 0.3 + seg.sens * 1.8;
        const passW = -0.3 + seg.sens * 0.9;
        const raidTerm = seg.id === 'CORE' ? r._raidC : r._raid;   // raidC = core-segment raid; raid = the other 3 segments (unchanged AMC semantics)
        let a = (base - (r.price - 1) * priceW + r.passMix * passW + raidTerm) * fitTo(segVecAt(seg, s), r);
        // Core-extreme zone perk (position-based, not bet-based): a small specialization tradeoff
        // against reach into every OTHER segment (generalizes the old Mainstream-only *0.95 penalty).
        if (r.pos[0] >= 0.75 && seg.id !== 'CORE') a *= 0.95;
        if (r._stranded) a *= (1 - CONFIG.STRANDED_PEN);
        a *= (1 - r._trackOutPen);
        a *= droughtDemandMult;
        // strategic-bet segment pulls (mission item 2): Exclusivity binds Core hard and severs the
        // Mainstream (DESTFAM) spillover channel near-zero; Values Brand binds Core more mildly and
        // partially repels DESTFAM+DAYTRIP (two-sided, not severed); Mega-Pass spills appeal wide into
        // both mainstream segments (instant reach).
        if (bets.exclusivity) {
          if (seg.id === 'CORE') a *= (1 + CONFIG.EXCLUSIVITY_CORE_BOOST);
          else if (seg.id === 'DESTFAM') a *= CONFIG.EXCLUSIVITY_SEVER;
        }
        if (bets.valuesBrand) {
          if (seg.id === 'CORE') a *= (1 + CONFIG.VALUESBRAND_CORE_BOOST);
          else if (seg.id === 'DESTFAM' || seg.id === 'DAYTRIP') a *= (1 - CONFIG.VALUESBRAND_REPEL);
        }
        if (bets.megapass && (seg.id === 'DESTFAM' || seg.id === 'DAYTRIP')) a *= (1 + CONFIG.MEGAPASS_SPILLOVER);
        appealBySeg[seg.id].push(Math.max(0.05, a));
      }
      if (r.pos[0] >= 0.75) r.rep = Math.min(1, r.rep + 0.02);   // niche-style rep gain, unchanged, applied once per resort
    }
    // exclusion territory: a SETTLED Core-extreme camper (stillSeasons >= SETTLE_SEASONS) posts the sign;
    // rivals inside EXCL_RADIUS on the terrain axis lose appeal, across every segment. Earned by holding
    // still there, not by a bet.
    resorts.forEach(holder => {
      if (!(holder.pos[0] >= 0.75 && (holder._stillSeasons || 0) >= CONFIG.SETTLE_SEASONS)) return;
      resorts.forEach(rival => {
        if (rival.i === holder.i) return;
        if (Math.abs(rival.pos[0] - holder.pos[0]) <= CONFIG.EXCL_RADIUS) {
          SEGMENTS.forEach(seg => { appealBySeg[seg.id][rival.i] *= (1 - CONFIG.EXCL_PEN); });
        }
      });
    });
    const sumBySeg = {}; SEGMENTS.forEach(seg => sumBySeg[seg.id] = appealBySeg[seg.id].reduce((a, b) => a + b, 0));
    const mktBySeg = {}; SEGMENTS.forEach(seg => mktBySeg[seg.id] = market * segShares[seg.id]);

    // felt-lifecycle trace (mission item 3): per-season, per-segment mass + a plain-language trend tag,
    // plus the pass-war and conversion-funnel event tags when they're active. Global (not per-resort);
    // exposed on the returned resorts array as `.segTrace` below.
    const seasonTrace = SEGMENTS.map(seg => {
      const mass = segShares[seg.id];
      const delta = prevShares ? mass - prevShares[seg.id] : 0;
      const trend = delta > 0.01 ? 'growing' : (delta < -0.01 ? 'fading' : 'stable');
      const event = (seg.id === 'DAYTRIP' && passWarBite > 0.02) ? 'pass-war-squeeze'
        : (seg.id === 'BEGINNER' ? 'conversion-outflow' : null);
      return seg.id === 'BEGINNER' ? { id: seg.id, name: seg.name, mass, delta, trend, event, outflow: convertOut }
                                    : { id: seg.id, name: seg.name, mass, delta, trend, event };
    });
    segTrace.push({ season: s, segments: seasonTrace });
    prevShares = segShares;

    // resolve economics
    let fieldProfit = [];
    for (const r of resorts) {
      let demand = 0;
      for (const seg of SEGMENTS) demand += mktBySeg[seg.id] * appealBySeg[seg.id][r.i] / sumBySeg[seg.id];
      // Labor gate. What a resort SELLS is set by the demand it earned (its fit to each segment, divided
      // by the crowd competing for that same segment, just above) and capped by the capacity it can
      // actually staff. Capacity nobody is there to run does not serve skiers, it only carries cost.
      r._staffReq = r.cap * CONFIG.STAFF_PER_CAP * (r.lodgeBuilt ? CONFIG.LODGE_STAFF_MULT : 1);
      r._util = Math.min(1, r.staff / Math.max(1, r._staffReq));
      const usableCap = r.cap * Math.pow(r._util, CONFIG.STAFF_K);
      const served = Math.min(demand, usableCap);
      if (r._util < 0.98) r.rep = Math.max(0, r.rep - CONFIG.UNDERSTAFF_REP * (1 - r._util));
      // sphere-size feed (mission item 3): a firm's served demand THIS season vs its own trailing
      // average (never keyed to cash, so the hidden final ranking stays hidden). Baseline is computed
      // from prior seasons only (before this season's served is pushed below).
      r._servedThisSeason = served;
      r._servedBaseline = r.seasonServed.length ? mean(r.seasonServed) : served;
      const scarce = r.cap < CONFIG.scarcityCapThreshold;
      const gapMult = scarce ? 0.12 : 1.0;
      if (demand > r.cap * 1.02) r.rep = Math.max(0, r.rep - CONFIG.serviceGapPenalty * gapMult * (demand - r.cap) / Math.max(1, demand));
      else r.rep = Math.min(1, r.rep + 0.03);
      if (scarce) r.rep = Math.min(1, r.rep + CONFIG.scarcityRep);
      if (r.price <= 1.0) r.rep = Math.min(1, r.rep + CONFIG.trustRep);
      const wallet = 1 + CONFIG.walletYield * Math.max(0, r._opsCost - 8);
      const terrainYieldBonus = r.pos[0] >= 0.75 ? 1.10 : 1.0;   // zone perk: Core country pays a yield premium
      const baseYield = CONFIG.baseYield * r.price * (1 + 0.5 * (1 - r.passMix)) * (1 + (scarce ? CONFIG.scarcityYield : 0)) * wallet * terrainYieldBonus;
      const weatherExposed = (1 - r.passMix);
      let effSnow = r.passMix >= CONFIG.hedgePassMix ? 1 + (snowMult - 1) * (1 - CONFIG.hedgeStrength) : snowMult;
      // Snowmaking (mission item 2): dampens the weather-yield swing further, symmetric (trims both the
      // drought downside and the powder upside) - insurance, not a jackpot, per the bet's own framing.
      if (r.bets && r.bets.snowmaking) effSnow = 1 + (effSnow - 1) * (1 - CONFIG.SNOWMAKING_HEDGE);
      // Summer Events -> DROUGHT HEDGE (mission item 1): weather-countercyclical, not a flat annuity.
      // Pays off strongly in a bad-snow season, modestly in normal, and costs opportunity in a powder
      // season (real weather-risk strategy, symmetric to Snowmaking's demand-side hedge above).
      const eventsWeatherMult = snow === 'drought' ? CONFIG.EVENTS_DROUGHT_MULT : (snow === 'powder' ? CONFIG.EVENTS_POWDER_MULT : 1);
      const eventsRev = CONFIG.EVENTS_REV * eventsWeatherMult * (r._spendEvents || 0) / (1 + (r._spendEvents || 0) / CONFIG.EVENTS_SAT);
      const revenue = served * baseYield * (1 + (effSnow - 1) * weatherExposed) + eventsRev;
      // Cost Redesign (mission item 2): no demand pull, cuts running cost flat.
      // payroll is charged on the crew you HOLD, not the crew you need, so over-hiring is a real mistake
      // and the hiring decision has a downside as well as an upside.
      r._payroll = r.staff * CONFIG.STAFF_WAGE;
      // Running the mountain harder than it was built for costs more than proportionally: overtime,
      // wear, lift queues, grooming hours. Without this the dial was linear in cost and better than
      // linear in benefit (it buys capacity AND raises spend per skier), so maxing it was always
      // right and the dial was a direction rather than a decision. G10 is the test of that.
      const push = Math.max(0, r._opsCost - 8);
      const opsCost = r._opsCost + CONFIG.OPS_CONVEX * push * push;
      const runCost = opsCost + CONFIG.fixedCost + r._payroll - (r.bets && r.bets.costRedesign ? CONFIG.COST_REDESIGN_SAVING : 0);
      const leverSpend = (r._spendRuns || 0) + (r._spendLodging || 0) + (r._spendEvents || 0) + (r._spendMkt || 0) + (r._betSpend || 0);
      const profit = revenue - runCost - CONFIG.capCarry * r.cap - (r._repoCost || 0) - r._warCost - (r._moveCost || 0) - leverSpend;
      r.cash += profit; r.profit += profit;
      // cumulative build ledger for the team client's mountain view (display only; nothing reads it)
      if (!r.built) r.built = { runs: 0, lodging: 0, events: 0, marketing: 0 };
      r.built.runs += r._spendRuns || 0; r.built.lodging += r._spendLodging || 0;
      r.built.events += r._spendEvents || 0; r.built.marketing += r._spendMkt || 0;
      r.servedTotal += served; r.revTotal += revenue; r.seasonServed.push(served); r.seasonProfit.push(profit);
      r.capSum += r.cap;
      fieldProfit.push(profit);
    }
    const med = median(fieldProfit);
    for (const r of resorts) r.edges.push((fieldProfit[r.i] - med) / (Math.abs(med) + 20));
  }
  st.snow = snow; st.prevShares = prevShares;
  st.season = s + 1;
  return st;
}

function finalizeGame(st) {
  const { resorts, env, segTrace } = st;

  // terminal enterprise value + score. fitT now sums fit across all 4 lifecycle segments weighted by
  // their FINAL-season shares (generalizes the old coreT/CORE3f/MAIN3f 2-anchor blend).
  const finalS = CONFIG.SEASONS - 1;
  const finalShares = segMassShares(finalS, env).shares;
  for (const r of resorts) {
    // capability strength stands in for "activeAdv": durable capital built (lodging + catchment width),
    // since position no longer carries discrete advantage bets.
    const capStrength = (r.lodgeBuilt ? 0.5 : 0) + Math.min(0.5, r.width * 3);
    const insolvent = r.cash < 0 ? r.cash * 1.5 : 0;
    let fitT = 0;
    for (const seg of SEGMENTS) fitT += finalShares[seg.id] * fitTo(segVecAt(seg, finalS), r);
    r.termEV = CONFIG.termCapW * r.cap * (0.4 + 0.6 * fitT) + CONFIG.termRepW * r.rep + CONFIG.termAdvW * capStrength * (0.3 + 0.7 * fitT);
    r.score = r.profit + r.termEV + insolvent;
    r.peakEdge = Math.max(...r.edges);
    r.avgEdge = r.edges.reduce((a, b) => a + b, 0) / r.edges.length;
    r.s2lead = r.edges[0] + r.edges[1];
    let growth = 0;
    for (let s = 1; s < r.seasonServed.length; s++) growth = Math.max(growth, (r.seasonServed[s] - r.seasonServed[s - 1]) / (r.seasonServed[s - 1] + 1));
    const liveSeasons = r.renewSeasons.filter(Boolean).length;   // coverage: seasons the firm was actively renewing its position
    r.M = {
      econ: r.score,
      scale: r.servedTotal,
      premium: r.revTotal / (r.servedTotal + 1),
      resilience: Math.min(...r.seasonProfit),
      growth,
      coverage: liveSeasons / CONFIG.SEASONS,
      efficiency: r.score / (r.capSum / CONFIG.SEASONS + 1),
    };
  }
  scoreField(resorts);
  // felt lifecycle (mission item 3): per-season, per-segment mass/delta/trend trace, attached to the
  // returned array (not a new return shape) so every existing `simulateGame(...)` call site - runGames,
  // g2Test, worldFlipTest, placementWeightedTest, the tuner - keeps working unmodified.
  resorts.segTrace = segTrace;
  // stage-read hook (mission item 4): the hidden true stage per season, for the UI's diagnosis instrument.
  resorts.trueStageTrace = env.trueStageTrace;
  return resorts;
}

function simulateGame(assignment, seed, env) {
  const st = initGameState(assignment, seed, env);
  for (let s = 0; s < CONFIG.SEASONS; s++) stepSeason(st, {});
  return finalizeGame(st);
}

// ---------- secret-scorecard scoring (option B): each archetype judged on ITS OWN card ----------
const METRICS = ['econ', 'scale', 'premium', 'resilience', 'growth', 'coverage', 'efficiency'];
const SIG = {
  RENEWER: 'coverage',    // adaptive Chaser: hold a live, renewed position the most seasons
  VOLUME: 'growth',       // event promoter: win the early land grab
  NETWORK: 'scale',       // amenity empire-builder: biggest total throughput over the run
  PREMIUM: 'premium',     // terrain purist: highest yield per skier
  FORTRESS: 'resilience', // entrencher: steadiest floor through the shocks
  COST: 'efficiency',     // discounter: most value per unit of capacity
};

function scoreField(resorts) {
  const z = {};
  for (const m of METRICS) {
    const vals = resorts.map(r => r.M[m]);
    const mu = mean(vals), sd = Math.sqrt(variance(vals)) || 1;
    z[m] = vals.map(v => (v - mu) / sd);
  }
  resorts.forEach((r, i) => { r.selfScore = z[SIG[r.arch] || 'econ'][i]; });
}

function cumGrowth(s, scale) { scale = scale == null ? 1 : scale; let m = 1; for (let i = 0; i <= s; i++) m *= (1 + CONFIG.growth[i] * scale); return m; }
function median(a) { const b = [...a].sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }

// G5 track-out test (redefined for v2): a synthetic firm makes ONE material move at season `born`,
// then holds. Measures how many seasons its track-out penalty stays below a "still-live" threshold
// (0.15) before decaying past it, comparing a pre-inflection move to a post-inflection one. Since
// track-out decay accelerates post-inflection (inflectionDecayMult), a held position should go stale
// FASTER post-inflection: fewer live seasons.
function advDurationByPhase() {
  // Tests the track-out DECAY MECHANISM in isolation, not tangled up with the absolute season clock
  // (an earlier version tied "still" resets to the born season and let the global INFLECTION season
  // gate the multiplier; since grace = still-1 starts from 0 at any born season, the multiplier flip
  // always landed on the same grace value regardless of born, so pre and post were mathematically
  // guaranteed to tie). This version asks the real question directly: held perfectly still, does a
  // position stay "live" (track-out penalty < 0.15) for fewer seasons once the field has inflected?
  const HORIZON = 20;
  function liveSeasons(alwaysInflected) {
    let live = 0;
    for (let still = 0; still < HORIZON; still++) {
      const grace = Math.max(0, still - 1);
      const pen = Math.min(CONFIG.TRACKOUT_MAXPEN, grace * CONFIG.TRACKOUT_RATE * (alwaysInflected ? CONFIG.inflectionDecayMult : 1));
      if (pen < 0.15) live++; else break;
    }
    return live;
  }
  return { pre: liveSeasons(false), post: liveSeasons(true) };
}

// ---------- archetype decision policies: six seats, each a LEVER policy (mission item 5) ----------
// RENEWER = adaptive Chaser, FORTRESS = entrencher, VOLUME = event promoter, PREMIUM = terrain purist,
// NETWORK = amenity empire-builder, COST = discounter. Each season a policy sets lever spend
// (_spendRuns/_spendLodging/_spendEvents/_spendMkt) and the two continuous prices; position moves
// ONLY as a downstream consequence, resolved by resolveAxes() above.
function decide(r, s, inflected, core, resorts) {
  const A = r.arch;
  r._opsCost = 8;
  r._spendRuns = 0; r._spendLodging = 0; r._spendEvents = 0; r._spendMkt = 0;
  r._buyBet = null; r._betSpend = 0;   // reset each season; a policy below may set r._buyBet once
  const readCore = core + r.stageBias;   // the hidden stage, read with a per-game bias (sometimes wrong)
  if (A === 'RENEWER') {                 // ADAPTIVE CHASER: reads the sweet spot; spikes hard on a confident read,
    r.cap = Math.min(r.cap, 79); r._opsCost = 8;   // plays cheap and waits when the read is murky (variance/spike fix for G7)
    const confidence = Math.abs(readCore - 0.5);
    const wantCore = readCore >= 0.5;
    if (confidence > 0.15) {
      r._spendRuns = wantCore ? 11 : 2;
      r._spendLodging = wantCore ? 6 : 2;
      // priced to the segment actually being chased: CORE sits at priceAccess ~0.7 (budget-to-premium
      // axis), DESTFAM/LUXURY (what a lost-confidence-in-Core read pivots toward) sit at ~0.85-0.95 -
      // pricing the comfort pivot at CORE's old low-end (0.30/0.25) was underselling into segments that
      // are price-INSENSITIVE, not price-sensitive; that was leaving real revenue on the table.
      r.dayPassPrice = wantCore ? 0.75 : 0.60;
      r.lodgingRate  = wantCore ? 0.70 : 0.80;
    } else {
      r._spendRuns = 3; r._spendLodging = 2;
      r.dayPassPrice = 0.5; r.lodgingRate = 0.5;
    }
    r._spendMkt = 2;
  } else if (A === 'COST') {             // DISCOUNTER: pile-it-high-sell-it-low. Needs real CAPACITY to monetize
    r._opsCost = 12;                     // its price/share edge; low price with no volume base is pure margin loss.
    r._spendRuns = 2; r._spendLodging = 0; r._spendEvents = 0;
    r._spendMkt = s === 0 ? 4 : 6;
    r.dayPassPrice = 0.15; r.lodgingRate = 0.15;
    if (s === 0 && !r.bets.costRedesign) r._buyBet = 'costRedesign';   // discounter identity: cut running cost, no demand pull
  } else if (A === 'PREMIUM') {          // TERRAIN PURIST: front-loads Add Runs to earn/hold the expert reach gate
    r._opsCost = 7;
    r._spendRuns = s <= 2 ? 12 : 4;
    r._spendLodging = 0; r._spendEvents = 0; r._spendMkt = 1;
    r.dayPassPrice = 0.85; r.lodgingRate = 0.60;
    if (s === 1 && !r.bets.valuesBrand) r._buyBet = 'valuesBrand';   // binds Core, repels some Mainstream: the purist's identity
  } else if (A === 'FORTRESS') {         // ENTRENCHER: one big march to the Core extreme, then just enough
    // Retuned 2026-09-10: the season-0 march of 14 was priced for the old economy where position spend
    // was nearly free. The purist still makes the biggest single terrain push in the game, just not a
    // suicidal one, and it now runs enough capacity to serve the Core it captures.
    r._opsCost = 9;                      // upkeep to hold the gate and dodge track-out; moat widens with marketing later
    r._spendRuns = s === 0 ? 8 : CONFIG.RUNS_INFRA_THRESHOLD + 0.5;
    r._spendLodging = 0; r._spendEvents = 0;
    r._spendMkt = s >= 3 ? 3 : 1;
    r.dayPassPrice = 0.80; r.lodgingRate = 0.50;
    if (s === 1 && !r.bets.exclusivity) r._buyBet = 'exclusivity';   // after the march: dig in, sever the Mainstream link
  } else if (A === 'NETWORK') {          // AMENITY EMPIRE-BUILDER: buys the lodging gate early, then rides the
    // Retuned 2026-09-10 with the demand repricing. At dial 13 and lodging 13 this policy was paying
    // the convex push penalty and a heavy build into a market it could no longer fill, and it won 0%.
    // It is still the biggest operator on the hill; it just stopped setting money on fire to prove it.
    r._opsCost = 11;                     // cross-segment spillover wide with marketing, aimed at Destination
    r._spendLodging = s <= 1 ? 7 : 3;    // Family + Luxury (priceAccess ~0.85-0.95): priced up from the old
    r._spendRuns = 3;                    // 0.55/0.65 which underpriced into two price-INSENSITIVE segments.
    r._spendEvents = s === 2 ? 5 : 0;
    r._spendMkt = s >= 2 ? 5 : 2;
    r.dayPassPrice = 0.62; r.lodgingRate = 0.78;
    if (s === 0 && !r.bets.megapass) r._buyBet = 'megapass';   // instant wide reach, matches the empire-builder's identity
  } else if (A === 'VOLUME') {           // EVENT PROMOTER: steady Summer Events spend every season, generalist
    r._opsCost = 10;                     // mid-position; the smoothed revenue floor is the whole strategy
    r._spendEvents = 6;
    r._spendRuns = 3; r._spendLodging = 2; r._spendMkt = 3;
    r.dayPassPrice = 0.45; r.lodgingRate = 0.45;
    if (s === 0 && !r.bets.snowmaking) r._buyBet = 'snowmaking';   // risk-smoothing identity extends to the weather hedge too
  } else if (A === 'NEUTRAL') {          // the student seat's default, and the AI that fills an unclaimed one.
    // Deliberately competent but unremarkable: it invests a little, prices near the middle, and staffs
    // what it builds. A team that reads the lifecycle should beat it; a team that ignores the board
    // should not. It must never be the best policy in the game or the humans have nothing to add.
    r._opsCost = 9;
    r._spendRuns = 2; r._spendLodging = 1; r._spendEvents = 0; r._spendMkt = 2;
    r.dayPassPrice = 0.60; r.lodgingRate = 0.60;
  } else if (A === 'COAST') {            // cautionary baseline (not in the roster): one early move, then nothing
    if (s === 0) { r._spendRuns = 14; r._opsCost = 16; r.dayPassPrice = 0.7; r.lodgingRate = 0.4; }
    else { r._opsCost = 5; }
  }
  r.cap += (r._opsCost - 8) * CONFIG.CAP_GROWTH_MULT;
  // AI hiring: staff to the capacity this policy is about to be running, one season ahead. Kept
  // deliberately simple and identical across archetypes, per the ranch spec's rule that bots must
  // hire sensibly or the gates break for a reason that has nothing to do with the thing being tested.
  // A human seat can out-think this by hiring ahead of a build or running lean on purpose.
  const staffReq = r.cap * CONFIG.STAFF_PER_CAP * (r.lodgeBuilt ? CONFIG.LODGE_STAFF_MULT : 1);
  const shortBy = staffReq - r.staff;
  r._hire = shortBy <= 0 ? 0 : Math.min(CONFIG.HIRE_MAX, Math.ceil(shortBy / CONFIG.STAFF_PER_HIRE));
  r._pendingHire = r._hire;
}

// Pulled out of the gate-harness section below (make-engine.js keeps this in sync):
// ARCHES is read directly by the browser UI; mean/variance are called from stepSeason
// and decide() above this point. The rest of the harness does not ship to the browser.
const ARCHES = ['RENEWER', 'FORTRESS', 'VOLUME', 'PREMIUM', 'NETWORK', 'COST'];
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function variance(a) { const m = mean(a); return mean(a.map(x => (x - m) ** 2)); }


// ==========================================================================
// Browser export block (appended by make-engine.js; do not hand-edit engine-powder.js)
// Everything the multiplayer UI needs from the engine lives here.
// ==========================================================================
if (typeof window !== 'undefined') {
  window.PowderEngine = {
    CONFIG,
    ARCHES,
    POS_SEED3,
    BETS,
    SEGMENTS,
    MOVES,
    initGameState,
    stepSeason,
    finalizeGame,
    applyDecision,
    simulateGame,
    decide,
    aiMoveNode,
    envForGame,
    trueStageArray,
    segMassShares,
    segVecAt,
    mulberry32,
    clamp,
    dist3,
    spatialMods,
    intendedDelta,
    resolveAxes,
    fitTo,
    TEAM_SEATS,
    RIVALS,
    classroomField,
  };
} else if (typeof module !== 'undefined') {
  // Node.js path, for anything that requires this generated file directly instead of
  // chasing-powder.js itself.
  module.exports = {
    CONFIG,
    ARCHES,
    POS_SEED3,
    BETS,
    SEGMENTS,
    MOVES,
    initGameState,
    stepSeason,
    finalizeGame,
    applyDecision,
    simulateGame,
    decide,
    aiMoveNode,
    envForGame,
    trueStageArray,
    segMassShares,
    segVecAt,
    mulberry32,
    clamp,
    dist3,
    spatialMods,
    intendedDelta,
    resolveAxes,
    fitTo,
    TEAM_SEATS,
    RIVALS,
    classroomField,
  };
}

})();
