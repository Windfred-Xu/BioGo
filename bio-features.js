/**
 * bio-features.js
 * 「生物棋」三派系（病毒 / 细菌 / 真菌）规则模块 —— 骨架代码 v0.1
 *
 * 定位：独立、可插拔的规则层，不依赖也不修改「奇偶围棋」核心引擎
 * （parity-engine.js）的内部实现。核心引擎完成标准围棋判定
 * （气、提子、迁移目标候选、终局条件）后，在若干关键节点调用
 * 本模块导出的函数；本模块只负责阵营专属的状态与结算，不重新
 * 实现气/提子的基础算法。
 *
 * 【重要】集成说明
 * 本骨架未看到 parity-engine.js 源码，因此以下每个函数头部用
 * "// INTEGRATION:" 注明它期望被引擎在什么时机、以什么参数调用，
 * 以及期望引擎如何处理返回值。接入时请对照这些注释在
 * parity-engine.js 里插入调用点，而不是把本文件的逻辑搬进引擎里
 * ——保持解耦是为了让"纯围棋模式"完全不受影响（BIO_MODE=false 时
 * 本模块所有函数应被引擎跳过调用）。
 *
 * ============ 版本记录 ============
 * v0.1（本次交付）
 *   - 三派系状态机骨架：病毒-宿主寄生/归化、细菌-生物膜/二分裂/耐药、
 *     真菌-孢子化/机会性感染
 *   - 毒力点数（VP）资源系统
 *   - 相克循环：病毒克细菌（噬菌体返还）/ 细菌克真菌（抗真菌干扰）/
 *     真菌免疫病毒宿主寄生
 *   - 确定性护栏：所有随机决策统一走注入的 rng() 而非 Math.random()，
 *     保证与引擎已有的"随机种子"回放机制兼容
 *   - JSON 序列化字段对齐设计方案 v0.1 第8节
 * ===================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BioFeatures = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.1.0';

  // ---------------------------------------------------------------
  // 常量（数值取自设计方案 v0.1 第5/7节，均为初始建议值，需实测调整）
  // ---------------------------------------------------------------

  var FACTION = Object.freeze({
    VIRUS: 'virus',
    BACTERIA: 'bacteria',
    FUNGI: 'fungi'
  });

  var STATE = Object.freeze({
    ACTIVE: 'active',
    INFECTED: 'infected',
    SPORE: 'spore',
    RESISTANT: 'resistant',
    BIOFILM: 'biofilm'
  });

  var TIER_COST = Object.freeze({ 1: 4, 2: 3, 3: 2, 4: 1 });

  // 病毒归化阈值：等级越高，感染累计到几次就归化目标棋子
  var INFECTION_THRESHOLD_BY_TIER = Object.freeze({ 1: 1, 2: 2, 3: 3, 4: 4 });

  var VP_INITIAL = 96;
  var VP_REFUND_PER_CAPTURE = 1;
  var VP_REFUND_PHAGE_BONUS = 1;

  var BIOFILM_MIN_GROUP_SIZE = 2;
  var BIOFILM_LIBERTY_BONUS = 1;

  var RESISTANCE_THRESHOLD = 3;
  var RESISTANCE_EXTRA_LIBERTY_REQUIRED = 1;

  var DIVISION_MIN_LIBERTIES = 3;
  var DIVISION_COOLDOWN_TURNS = 2;
  var DIVISION_VP_COST = 1;

  var SPORE_REVIVAL_WINDOW_TURNS = 3;
  var SPORE_SPREAD_VP_COST = 2;
  var SPORE_SPREAD_MAX_USES = 2;

  var ANTIFUNGAL_INTERFERENCE_VP_COST = 1;

  // ---------------------------------------------------------------
  // 内部工具：确定性护栏
  // ---------------------------------------------------------------

  /**
   * 所有需要"从多个候选里选一个"的地方都必须走这个函数，禁止在
   * 本模块任何位置直接调用 Math.random()。rng 由调用方（引擎）注入，
   * 必须是一个确定性的、可通过种子重放的 () => number in [0,1) 函数，
   * 与引擎棋谱 JSON 里已经保存的"随机种子"共用同一个生成器实例。
   */
  function assertRng(rng) {
    if (typeof rng !== 'function') {
      throw new Error(
        'bio-features: rng 必须是引擎注入的确定性伪随机函数，' +
        '不允许省略或使用 Math.random 代替（会破坏棋谱回放）。'
      );
    }
  }

  function pickDeterministic(candidates, rng) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error('bio-features: pickDeterministic 收到空候选列表。');
    }
    assertRng(rng);
    var idx = Math.floor(rng() * candidates.length);
    if (idx >= candidates.length) idx = candidates.length - 1; // 护栏：浮点边界
    return candidates[idx];
  }

  function assertValidFaction(faction) {
    var valid = faction === FACTION.VIRUS || faction === FACTION.BACTERIA || faction === FACTION.FUNGI;
    if (!valid) {
      throw new Error('bio-features: 未知阵营 "' + faction + '"，必须是 virus/bacteria/fungi 之一。');
    }
  }

  function assertValidTier(tier) {
    if (!TIER_COST.hasOwnProperty(tier)) {
      throw new Error('bio-features: 未知危害等级 "' + tier + '"，必须是 1~4。');
    }
  }

  // ---------------------------------------------------------------
  // 数据结构
  // ---------------------------------------------------------------

  /**
   * 单枚棋子的生物学元数据。key 建议用引擎现有的棋子/坐标唯一标识
   * （例如 "x,y" 或引擎内部的 stoneId），存放在 BioGameState.stoneMeta 里。
   */
  function createStoneMeta(faction, tier, color) {
    assertValidFaction(faction);
    assertValidTier(tier);
    return {
      faction: faction,
      tier: tier,
      color: color,           // 'black' | 'white'，与核心引擎的颜色字段保持一致
      state: STATE.ACTIVE,
      infectionCount: 0,
      captureCount: 0,       // 被提后成功迁移/替换的次数，也是棋面的破损等级
      resistanceCount: 0,
      sporeTimer: null,       // 非孢子状态为 null；孢子状态为剩余回合数
      sporeInterfered: false, // 是否已被细菌"抗真菌干扰"命中
      divisionCooldown: 0     // 该棋子所在群组下次可分裂前还需等待的回合数
    };
  }

  /**
   * 每局的生物棋整体状态：双方 VP、每颗棋子的元数据表、孢子标记列表、
   * 孢子远播使用次数计数。
   */
  function createInitialBioState(players) {
    // players: ['black', 'white'] 或引擎里实际使用的玩家标识数组
    var vp = {};
    var sporeSpreadUsed = {};
    players.forEach(function (p) {
      vp[p] = VP_INITIAL;
      sporeSpreadUsed[p] = 0;
    });
    return {
      version: VERSION,
      vp: vp,
      sporeSpreadUsed: sporeSpreadUsed,
      stoneMeta: {},   // key -> createStoneMeta(...) 的返回值
      sporeMarkers: {} // key -> { originOwner, color, turnsElapsed, interfered }
    };
  }

  // ---------------------------------------------------------------
  // VP（毒力点数）结算
  // ---------------------------------------------------------------

  function vpCostForTier(tier) {
    assertValidTier(tier);
    return TIER_COST[tier];
  }

  function canAffordPlacement(bioState, player, tier) {
    assertValidTier(tier);
    return bioState.vp[player] >= vpCostForTier(tier);
  }

  function deductVP(bioState, player, amount) {
    if (bioState.vp[player] < amount) {
      throw new Error(
        'bio-features: 玩家 ' + player + ' 的 VP 不足以扣除 ' + amount +
        '（当前 ' + bioState.vp[player] + '）。调用方应先用 canAffordPlacement 检查。'
      );
    }
    bioState.vp[player] -= amount;
    return bioState.vp[player];
  }

  function refundVP(bioState, player, amount) {
    bioState.vp[player] += amount;
    return bioState.vp[player];
  }

  // ---------------------------------------------------------------
  // 落子合法性（阵营专属限制）
  // ---------------------------------------------------------------

  /**
   * INTEGRATION: 引擎在完成"这是一次合法的围棋落子"的判定之后、
   * 真正把棋子写入棋盘之前调用本函数。返回 { ok: false, reason } 时
   * 引擎应拒绝本次落子（不消耗回合），并把 reason 展示给玩家。
   *
   * @param {object} bioState
   * @param {object} board 只读的棋盘查询接口，至少需要：
   *   board.getStoneAt(pos) -> stoneMeta 或 null
   *   board.getOrthogonalNeighbors(pos) -> pos[]
   *   board.getAllNeighbors(pos) -> pos[]（含斜向，用于真菌蔓延判定）
   * @param {string} player
   * @param {[number, number]} pos
   * @param {string} color
   * @param {string} faction
   * @param {number} tier 1~4
   * @param {object} [options]
   * @param {boolean} [options.declareSporeSpread] 真菌"孢子远播"声明
   */
  function validatePlacement(bioState, board, player, pos, color, faction, tier, options) {
    assertValidFaction(faction);
    assertValidTier(tier);
    options = options || {};

    var cost = vpCostForTier(tier);
    var isSporeSpread = faction === FACTION.FUNGI && options.declareSporeSpread === true;
    if (isSporeSpread) cost += SPORE_SPREAD_VP_COST;

    if (bioState.vp[player] < cost) {
      return { ok: false, reason: 'VP_INSUFFICIENT', detail: '需要 ' + cost + ' 点毒力点数，剩余 ' + bioState.vp[player] };
    }

    if (faction === FACTION.FUNGI && !isSporeSpread) {
      var hasExistingFungalAdjacent = board.getAllNeighbors(pos).some(function (n) {
        var meta = board.getStoneAt(n);
        return meta && meta.faction === FACTION.FUNGI && meta.color === color && meta.state !== STATE.SPORE;
      });
      var isFirstFungalStoneOfColor = !hasAnyActiveFungalStone(bioState, color);
      if (!hasExistingFungalAdjacent && !isFirstFungalStoneOfColor) {
        return {
          ok: false,
          reason: 'FUNGI_MYCELIAL_CONSTRAINT',
          detail: '真菌棋子（首子除外）只能落在己方已有真菌棋子的相邻空点，或改用孢子远播（消耗额外 ' + SPORE_SPREAD_VP_COST + ' 点VP）。'
        };
      }
    }

    if (isSporeSpread) {
      if (bioState.sporeSpreadUsed[player] >= SPORE_SPREAD_MAX_USES) {
        return { ok: false, reason: 'SPORE_SPREAD_LIMIT_REACHED', detail: '孢子远播每方每局限用 ' + SPORE_SPREAD_MAX_USES + ' 次。' };
      }
    }

    return { ok: true, cost: cost, isSporeSpread: isSporeSpread };
  }

  function hasAnyActiveFungalStone(bioState, color) {
    var keys = Object.keys(bioState.stoneMeta);
    for (var i = 0; i < keys.length; i++) {
      var meta = bioState.stoneMeta[keys[i]];
      if (meta.faction === FACTION.FUNGI && meta.color === color && meta.state !== STATE.SPORE) {
        return true;
      }
    }
    return false;
  }

  /**
   * INTEGRATION: validatePlacement 返回 ok:true 后，引擎实际落子成功时调用，
   * 完成 VP 扣除 + 元数据登记。
   */
  function commitPlacement(bioState, player, key, pos, color, faction, tier, validation) {
    deductVP(bioState, player, validation.cost);
    bioState.stoneMeta[key] = createStoneMeta(faction, tier, color);
    if (validation.isSporeSpread) {
      bioState.sporeSpreadUsed[player] += 1;
    }
    return bioState.stoneMeta[key];
  }

  // ---------------------------------------------------------------
  // 提子结算（迁移目标选择 / 感染 / 孢子化 / 噬菌体返还）
  // ---------------------------------------------------------------

  /**
   * INTEGRATION: 引擎在计算出某群组即将被提、并且已经按核心规则
   * 算出"迁移目标候选气孔列表"之后、真正执行迁移之前，对候选列表
   * 里的**每一枚待迁移棋子**调用本函数来决定最终目标点。
   * 非病毒阵营应仍按引擎原有随机逻辑（用同一个 rng）挑选，以保持
   * "其余阵营仍按原规则随机打破同距"的设计意图——因此本函数把
   * 非病毒情况也接管了，引擎只需统一调用这一个入口。
   */
  function pickMigrationTarget(stoneMeta, candidates, rng, chooseCallback) {
    if (stoneMeta.faction === FACTION.VIRUS) {
      // 变异选择：病毒方任选。chooseCallback 是引擎提供的、向对应玩家
      // 请求"从 candidates 中选一个"的交互回调（同步返回选中项）。
      // 若引擎暂不支持交互式选择，可退化为 pickDeterministic 占位，
      // 但这会削弱"变异选择"的策略价值，建议尽快接交互回调。
      if (typeof chooseCallback === 'function') {
        var chosen = chooseCallback(candidates);
        if (candidates.indexOf(chosen) === -1) {
          throw new Error('bio-features: chooseCallback 返回了不在候选列表中的坐标。');
        }
        return chosen;
      }
      return pickDeterministic(candidates, rng);
    }
    return pickDeterministic(candidates, rng);
  }

  /**
   * INTEGRATION: 引擎完成一次提子（含迁移）后调用一次，传入本次
   * 被提群组和执行提子一方的信息，本函数处理三派系各自的"提子后
   * 结算"，并返回一个结算摘要供引擎/UI 展示。
   *
   * @param {object} bioState
   * @param {object} board
   * @param {object} captureEvent
   * @param {Array} captureEvent.capturedStones 每项 { key, pos, migratedTo }
   * @param {string} captureEvent.capturingFaction 提子一方**最后一手棋子**的阵营
   *   （相克判定按"谁完成的提子动作"算，而不是按整个群组）
   * @param {string} captureEvent.capturingPlayer
   * @param {object} rng
   */
  function resolveCaptureAftermath(bioState, board, captureEvent, rng) {
    assertRng(rng);
    var summary = { infections: [], sporesCreated: [], vpRefunded: 0 };

    // 基础提子 VP 回收（见设计方案第5节，避免长局后期资源枯竭）
    refundVP(bioState, captureEvent.capturingPlayer, VP_REFUND_PER_CAPTURE);
    summary.vpRefunded += VP_REFUND_PER_CAPTURE;

    var containsBacteria = captureEvent.capturedStones.some(function (s) {
      var meta = bioState.stoneMeta[s.key];
      return meta && meta.faction === FACTION.BACTERIA;
    });
    if (captureEvent.capturingFaction === FACTION.VIRUS && containsBacteria) {
      refundVP(bioState, captureEvent.capturingPlayer, VP_REFUND_PHAGE_BONUS);
      summary.vpRefunded += VP_REFUND_PHAGE_BONUS;
    }

    captureEvent.capturedStones.forEach(function (s) {
      var meta = bioState.stoneMeta[s.key];
      if (!meta) return;

      if (meta.faction === FACTION.FUNGI) {
        // 真菌不迁移，原地孢子化——INTEGRATION: 引擎需要在识别到
        // 被提子是真菌阵营时，跳过自己的默认迁移写入，改为调用本函数
        // 处理的结果（在原坐标 s.pos 放置孢子标记，而不是 s.migratedTo）。
        meta.state = STATE.SPORE;
        meta.sporeTimer = SPORE_REVIVAL_WINDOW_TURNS;
        bioState.sporeMarkers[s.key] = {
          originOwner: meta.color,
          color: meta.color,
          pos: s.pos,
          turnsElapsed: 0,
          interfered: false
        };
        summary.sporesCreated.push(s.key);
        return;
      }

      if (meta.faction === FACTION.VIRUS && s.migratedTo && captureEvent.capturingFaction) {
        // 宿主寄生：对迁移落点相邻的、属于提子方的其他棋子标记感染
        var neighbors = board.getOrthogonalNeighbors(s.migratedTo);
        neighbors.forEach(function (n) {
          var neighborMeta = board.getStoneAt(n);
          if (!neighborMeta || neighborMeta.color !== captureEvent.capturingPlayer) return;
          if (neighborMeta.faction === FACTION.FUNGI) return; // 真菌免疫，见第4节
          neighborMeta.infectionCount += 1;
          var threshold = INFECTION_THRESHOLD_BY_TIER[meta.tier];
          if (neighborMeta.infectionCount >= threshold && neighborMeta.faction !== FACTION.VIRUS) {
            neighborMeta.state = STATE.INFECTED;
            summary.infections.push({ key: n, willConvertNextResolve: true });
            // INTEGRATION: 引擎应在"下一次结算"（例如下一回合开始）时
            // 真正把 neighborMeta.faction 改写为 FACTION.VIRUS，
            // 本函数只标记意图，不在提子结算的同一时刻立即变更阵营，
            // 以匹配设计方案"下一次结算时转为病毒阵营"的措辞。
          }
        });
      }
    });

    return summary;
  }

  /**
   * INTEGRATION: 引擎判定"围子已完成合法包围但因效果（生物膜/耐药）
   * 未能真正提走"这一事件时调用（即一次围子尝试失败）。
   */
  function onFailedCaptureAttempt(bioState, groupKeys) {
    groupKeys.forEach(function (key) {
      var meta = bioState.stoneMeta[key];
      if (meta && meta.faction === FACTION.BACTERIA) {
        meta.resistanceCount += 1;
        if (meta.resistanceCount >= RESISTANCE_THRESHOLD) {
          meta.state = STATE.RESISTANT;
        }
      }
    });
  }

  // ---------------------------------------------------------------
  // 气数修正（生物膜 / 耐药 / 机会性感染）——供引擎的气数计算调用
  // ---------------------------------------------------------------

  /**
   * INTEGRATION: 引擎在计算某个群组的"提子所需气数"时，先用标准
   * 围棋规则算出 baseLiberties，再调用本函数得到修正后的有效气数。
   * defenderFactionCounts / attackerFaction 用于同时应用生物膜加成、
   * 耐药加成、真菌机会性感染减益三条规则（互不冲突，按顺序叠加）。
   */
  function effectiveLibertyCount(baseLiberties, group, attackerFaction) {
    var liberties = baseLiberties;

    var allSameBacteria = group.length >= BIOFILM_MIN_GROUP_SIZE &&
      group.every(function (m) { return m.faction === FACTION.BACTERIA; });
    if (allSameBacteria) {
      liberties += BIOFILM_LIBERTY_BONUS;
    }

    var anyResistant = group.some(function (m) { return m.state === STATE.RESISTANT; });
    if (anyResistant) {
      liberties += RESISTANCE_EXTRA_LIBERTY_REQUIRED;
    }

    if (attackerFaction === FACTION.FUNGI && baseLiberties === 1) {
      liberties = Math.max(0, liberties - 1);
    }

    return liberties;
  }

  // ---------------------------------------------------------------
  // 主动效果：二分裂 / 抗真菌干扰
  // ---------------------------------------------------------------

  /**
   * INTEGRATION: 玩家在自己回合结束前主动触发。引擎需先确认该群组
   * 全员为细菌阵营、同色、正交连通，再调用本函数做资格与资源检查，
   * 检查通过后由引擎自己在返回的 targetLiberty 处落子（不消耗正常
   * 落子权），并调用 registerDivisionUsed 记录冷却。
   */
  function attemptDivision(bioState, player, group, groupKey, currentTurn, rng) {
    if (group.length < 1) throw new Error('bio-features: attemptDivision 收到空群组。');
    var liberties = group.liberties; // 引擎传入：该群组当前的气孔坐标数组
    if (!liberties || liberties.length < DIVISION_MIN_LIBERTIES) {
      return { ok: false, reason: 'NOT_ENOUGH_LIBERTIES' };
    }
    var cooldownUntil = bioState.divisionCooldownByGroup && bioState.divisionCooldownByGroup[groupKey];
    if (cooldownUntil && currentTurn < cooldownUntil) {
      return { ok: false, reason: 'ON_COOLDOWN', availableAtTurn: cooldownUntil };
    }
    if (bioState.vp[player] < DIVISION_VP_COST) {
      return { ok: false, reason: 'VP_INSUFFICIENT' };
    }
    deductVP(bioState, player, DIVISION_VP_COST);
    var targetLiberty = pickDeterministic(liberties, rng);
    return { ok: true, targetLiberty: targetLiberty };
  }

  function registerDivisionUsed(bioState, groupKey, currentTurn) {
    if (!bioState.divisionCooldownByGroup) bioState.divisionCooldownByGroup = {};
    bioState.divisionCooldownByGroup[groupKey] = currentTurn + DIVISION_COOLDOWN_TURNS;
  }

  /**
   * INTEGRATION: 细菌方对相邻真菌孢子标记发起干扰，成功后该孢子
   * 本轮复苏判定必然失败（见 tickSporeTimers）。
   */
  function attemptAntifungalInterference(bioState, player, sporeKey) {
    var marker = bioState.sporeMarkers[sporeKey];
    if (!marker) return { ok: false, reason: 'SPORE_NOT_FOUND' };
    if (bioState.vp[player] < ANTIFUNGAL_INTERFERENCE_VP_COST) {
      return { ok: false, reason: 'VP_INSUFFICIENT' };
    }
    deductVP(bioState, player, ANTIFUNGAL_INTERFERENCE_VP_COST);
    marker.interfered = true;
    return { ok: true };
  }

  // ---------------------------------------------------------------
  // 孢子生命周期（每回合结束调用一次）
  // ---------------------------------------------------------------

  /**
   * INTEGRATION: 引擎在每个完整回合结束时对所有 sporeMarkers 调用一次。
   * 返回需要引擎同步到棋盘的变更列表：复苏（还给原棋手）或永久死点。
   */
  function tickSporeTimers(bioState, board) {
    var changes = [];
    Object.keys(bioState.sporeMarkers).forEach(function (key) {
      var marker = bioState.sporeMarkers[key];
      marker.turnsElapsed += 1;

      var hasAdjacentActiveFungi = board.getOrthogonalNeighbors(marker.pos).some(function (n) {
        var meta = board.getStoneAt(n);
        return meta && meta.faction === FACTION.FUNGI && meta.color === marker.color && meta.state !== STATE.SPORE;
      });

      if (marker.turnsElapsed >= SPORE_REVIVAL_WINDOW_TURNS) {
        if (hasAdjacentActiveFungi && !marker.interfered) {
          changes.push({ key: key, result: 'REVIVED', pos: marker.pos, color: marker.color });
          var meta = bioState.stoneMeta[key];
          if (meta) {
            meta.state = STATE.ACTIVE;
            meta.sporeTimer = null;
          }
        } else {
          changes.push({ key: key, result: 'PERMANENT_DEAD_POINT', pos: marker.pos });
        }
        delete bioState.sporeMarkers[key];
      }
    });
    return changes;
  }

  // ---------------------------------------------------------------
  // 序列化（对齐设计方案 v0.1 第8节的 JSON schema）
  // ---------------------------------------------------------------

  function serializeStoneMeta(meta) {
    return {
      faction: meta.faction,
      tier: meta.tier,
      state: meta.state,
      infectionCount: meta.infectionCount,
      resistanceCount: meta.resistanceCount,
      sporeTimer: meta.sporeTimer
    };
  }

  function deserializeStoneMeta(data, color) {
    assertValidFaction(data.faction);
    assertValidTier(data.tier);
    var meta = createStoneMeta(data.faction, data.tier, color);
    meta.state = data.state || STATE.ACTIVE;
    meta.infectionCount = data.infectionCount || 0;
    meta.resistanceCount = data.resistanceCount || 0;
    meta.sporeTimer = typeof data.sporeTimer === 'number' ? data.sporeTimer : null;
    return meta;
  }

  // ---------------------------------------------------------------
  // 导出
  // ---------------------------------------------------------------

  return {
    VERSION: VERSION,
    FACTION: FACTION,
    STATE: STATE,
    CONFIG: Object.freeze({
      TIER_COST: TIER_COST,
      INFECTION_THRESHOLD_BY_TIER: INFECTION_THRESHOLD_BY_TIER,
      VP_INITIAL: VP_INITIAL,
      VP_REFUND_PER_CAPTURE: VP_REFUND_PER_CAPTURE,
      VP_REFUND_PHAGE_BONUS: VP_REFUND_PHAGE_BONUS,
      BIOFILM_MIN_GROUP_SIZE: BIOFILM_MIN_GROUP_SIZE,
      BIOFILM_LIBERTY_BONUS: BIOFILM_LIBERTY_BONUS,
      RESISTANCE_THRESHOLD: RESISTANCE_THRESHOLD,
      RESISTANCE_EXTRA_LIBERTY_REQUIRED: RESISTANCE_EXTRA_LIBERTY_REQUIRED,
      DIVISION_MIN_LIBERTIES: DIVISION_MIN_LIBERTIES,
      DIVISION_COOLDOWN_TURNS: DIVISION_COOLDOWN_TURNS,
      DIVISION_VP_COST: DIVISION_VP_COST,
      SPORE_REVIVAL_WINDOW_TURNS: SPORE_REVIVAL_WINDOW_TURNS,
      SPORE_SPREAD_VP_COST: SPORE_SPREAD_VP_COST,
      SPORE_SPREAD_MAX_USES: SPORE_SPREAD_MAX_USES,
      ANTIFUNGAL_INTERFERENCE_VP_COST: ANTIFUNGAL_INTERFERENCE_VP_COST
    }),

    createInitialBioState: createInitialBioState,
    createStoneMeta: createStoneMeta,

    vpCostForTier: vpCostForTier,
    canAffordPlacement: canAffordPlacement,
    deductVP: deductVP,
    refundVP: refundVP,

    validatePlacement: validatePlacement,
    commitPlacement: commitPlacement,

    pickMigrationTarget: pickMigrationTarget,
    resolveCaptureAftermath: resolveCaptureAftermath,
    onFailedCaptureAttempt: onFailedCaptureAttempt,

    effectiveLibertyCount: effectiveLibertyCount,

    attemptDivision: attemptDivision,
    registerDivisionUsed: registerDivisionUsed,
    attemptAntifungalInterference: attemptAntifungalInterference,

    tickSporeTimers: tickSporeTimers,

    serializeStoneMeta: serializeStoneMeta,
    deserializeStoneMeta: deserializeStoneMeta,

    // 仅暴露给测试文件使用，正式集成不应依赖这个底层工具
    _internal: { pickDeterministic: pickDeterministic }
  };
});
