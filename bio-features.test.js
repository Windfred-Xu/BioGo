/**
 * bio-features.test.js
 * bio-features.js 的基础回归测试骨架 v0.1
 *
 * 与项目现有的 `npm test`（引擎回归）保持同样的组织方式：
 * 纯 Node 内置 assert，不引入额外测试框架依赖，方便直接并入
 * 现有的测试脚本或用 `node bio-features.test.js` 单独跑。
 *
 * 覆盖范围：数值配置的护栏检查 + 每条规则的最小可验证场景。
 * 不覆盖：与真实棋盘/引擎的联调（那部分要等 parity-engine.js
 * 接上 INTEGRATION 注释里的调用点之后，用 verify-browser.cjs
 * 或专门的联调用例来跑）。
 */

'use strict';

var assert = require('assert');
var Bio = require('./bio-features.js');

// 一个最简化、确定性的 mock rng：固定返回序列，方便断言选中的下标
function makeSeqRng(sequence) {
  var i = 0;
  return function () {
    var v = sequence[i % sequence.length];
    i += 1;
    return v;
  };
}

// 最简化的 mock board，只实现本模块用到的三个方法
function makeMockBoard(stoneMetaByPosKey, neighborMap) {
  return {
    getStoneAt: function (pos) {
      return stoneMetaByPosKey[pos.join(',')] || null;
    },
    getOrthogonalNeighbors: function (pos) {
      return neighborMap[pos.join(',')] || [];
    },
    getAllNeighbors: function (pos) {
      return neighborMap[pos.join(',')] || [];
    }
  };
}

var results = { pass: 0, fail: 0 };

function test(name, fn) {
  try {
    fn();
    results.pass += 1;
    console.log('  ok - ' + name);
  } catch (err) {
    results.fail += 1;
    console.log('  FAIL - ' + name);
    console.log('    ' + err.message);
  }
}

console.log('bio-features.js v' + Bio.VERSION + ' 回归测试');

// ---------------------------------------------------------------
// VP 与落子成本
// ---------------------------------------------------------------

test('第一类落子成本为4点，四类分别对应4/3/2/1', function () {
  assert.strictEqual(Bio.vpCostForTier(1), 4);
  assert.strictEqual(Bio.vpCostForTier(2), 3);
  assert.strictEqual(Bio.vpCostForTier(3), 2);
  assert.strictEqual(Bio.vpCostForTier(4), 1);
});

test('未知危害等级必须抛出异常（确定性护栏，不允许静默兜底）', function () {
  assert.throws(function () { Bio.vpCostForTier(5); }, /未知危害等级/);
});

test('VP不足时 canAffordPlacement 返回 false', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.vp.black = 2;
  assert.strictEqual(Bio.canAffordPlacement(state, 'black', 1), false); // 第一类要4点
  assert.strictEqual(Bio.canAffordPlacement(state, 'black', 4), true);  // 第四类要1点
});

test('deductVP 在余额不足时必须抛异常而不是允许负数', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.vp.black = 1;
  assert.throws(function () { Bio.deductVP(state, 'black', 5); }, /VP.*不足/);
  assert.strictEqual(state.vp.black, 1, 'VP不应该在抛异常后被意外扣除');
});

// ---------------------------------------------------------------
// 真菌蔓延限制
// ---------------------------------------------------------------

test('真菌首子不受蔓延限制', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  var board = makeMockBoard({}, { '2,2': [] });
  var v = Bio.validatePlacement(state, board, 'black', [2, 2], 'black', Bio.FACTION.FUNGI, 3);
  assert.strictEqual(v.ok, true);
});

test('真菌非首子且无相邻同色真菌时应被拒绝', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  // 先登记一颗已存在的真菌棋子（模拟已经落过一手）
  state.stoneMeta['0,0'] = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  var board = makeMockBoard(
    { '0,0': state.stoneMeta['0,0'] },
    { '5,5': [] } // 目标点 (5,5) 没有相邻棋子
  );
  var v = Bio.validatePlacement(state, board, 'black', [5, 5], 'black', Bio.FACTION.FUNGI, 3);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'FUNGI_MYCELIAL_CONSTRAINT');
});

test('声明孢子远播可以绕过蔓延限制，但要多付VP且有次数上限', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['0,0'] = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  var board = makeMockBoard({ '0,0': state.stoneMeta['0,0'] }, { '5,5': [] });

  var v1 = Bio.validatePlacement(state, board, 'black', [5, 5], 'black', Bio.FACTION.FUNGI, 3, { declareSporeSpread: true });
  assert.strictEqual(v1.ok, true);
  assert.strictEqual(v1.cost, Bio.vpCostForTier(3) + Bio.CONFIG.SPORE_SPREAD_VP_COST);

  state.sporeSpreadUsed.black = Bio.CONFIG.SPORE_SPREAD_MAX_USES;
  var v2 = Bio.validatePlacement(state, board, 'black', [5, 5], 'black', Bio.FACTION.FUNGI, 3, { declareSporeSpread: true });
  assert.strictEqual(v2.ok, false);
  assert.strictEqual(v2.reason, 'SPORE_SPREAD_LIMIT_REACHED');
});

// ---------------------------------------------------------------
// 生物膜 / 耐药气数修正
// ---------------------------------------------------------------

test('两枚以上同色细菌相连时，有效气数+1', function () {
  var group = [
    Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'black'),
    Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'black')
  ];
  assert.strictEqual(Bio.effectiveLibertyCount(2, group, null), 3);
});

test('单枚细菌不触发生物膜加成', function () {
  var group = [Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'black')];
  assert.strictEqual(Bio.effectiveLibertyCount(2, group, null), 2);
});

test('耐药状态额外增加1口气要求', function () {
  var meta = Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'black');
  meta.state = Bio.STATE.RESISTANT;
  assert.strictEqual(Bio.effectiveLibertyCount(2, [meta], null), 3);
});

test('真菌方对残血（1口气）群组有机会性感染减益', function () {
  var group = [Bio.createStoneMeta(Bio.FACTION.VIRUS, 3, 'white')];
  assert.strictEqual(Bio.effectiveLibertyCount(1, group, Bio.FACTION.FUNGI), 0);
});

test('三次围子失败后细菌进入耐药状态', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['a'] = Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'black');
  Bio.onFailedCaptureAttempt(state, ['a']);
  Bio.onFailedCaptureAttempt(state, ['a']);
  assert.strictEqual(state.stoneMeta['a'].state, Bio.STATE.ACTIVE);
  Bio.onFailedCaptureAttempt(state, ['a']);
  assert.strictEqual(state.stoneMeta['a'].state, Bio.STATE.RESISTANT);
});

// ---------------------------------------------------------------
// 提子结算：噬菌体返还 / 感染 / 真菌免疫 / 孢子化
// ---------------------------------------------------------------

test('病毒提走含细菌的群组时获得噬菌体VP返还', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.vp.black = 0;
  state.stoneMeta['b1'] = Bio.createStoneMeta(Bio.FACTION.BACTERIA, 3, 'white');
  var board = makeMockBoard({}, { '3,3': [] });
  var rng = makeSeqRng([0]);

  var summary = Bio.resolveCaptureAftermath(state, board, {
    capturedStones: [{ key: 'b1', pos: [1, 1], migratedTo: [3, 3] }],
    capturingFaction: Bio.FACTION.VIRUS,
    capturingPlayer: 'black'
  }, rng);

  assert.strictEqual(summary.vpRefunded, Bio.CONFIG.VP_REFUND_PER_CAPTURE + Bio.CONFIG.VP_REFUND_PHAGE_BONUS);
  assert.strictEqual(state.vp.black, summary.vpRefunded);
});

test('真菌被提子后原地孢子化，而不是走迁移逻辑', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['f1'] = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'white');
  var board = makeMockBoard({}, { '9,9': [] });
  var rng = makeSeqRng([0]);

  var summary = Bio.resolveCaptureAftermath(state, board, {
    capturedStones: [{ key: 'f1', pos: [1, 1], migratedTo: [9, 9] }],
    capturingFaction: Bio.FACTION.BACTERIA,
    capturingPlayer: 'black'
  }, rng);

  assert.strictEqual(state.stoneMeta['f1'].state, Bio.STATE.SPORE);
  assert.strictEqual(state.stoneMeta['f1'].sporeTimer, Bio.CONFIG.SPORE_REVIVAL_WINDOW_TURNS);
  assert.deepStrictEqual(summary.sporesCreated, ['f1']);
  assert.ok(state.sporeMarkers['f1'], '应登记孢子标记');
  assert.deepStrictEqual(state.sporeMarkers['f1'].pos, [1, 1], '孢子应留在原坐标而不是迁移目标坐标');
});

test('真菌阵营棋子对病毒宿主寄生天然免疫，不会被标记感染', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['v1'] = Bio.createStoneMeta(Bio.FACTION.VIRUS, 2, 'black');
  var fungiNeighbor = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'white');
  var board = makeMockBoard(
    { '2,2': fungiNeighbor },
    { '3,3': [[2, 2]] }
  );
  var rng = makeSeqRng([0]);

  Bio.resolveCaptureAftermath(state, board, {
    capturedStones: [{ key: 'v1', pos: [1, 1], migratedTo: [3, 3] }],
    capturingFaction: null,
    capturingPlayer: 'white'
  }, rng);

  assert.strictEqual(fungiNeighbor.infectionCount, 0, '真菌不应被病毒感染计数');
});

// ---------------------------------------------------------------
// 孢子生命周期
// ---------------------------------------------------------------

test('孢子在复苏窗口内相邻有活真菌则复苏', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['f1'] = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  state.stoneMeta['f1'].state = Bio.STATE.SPORE;
  state.sporeMarkers['f1'] = { originOwner: 'black', color: 'black', pos: [0, 0], turnsElapsed: 0, interfered: false };

  var activeFungiNeighbor = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  var board = makeMockBoard(
    { '1,0': activeFungiNeighbor },
    { '0,0': [[1, 0]] }
  );

  for (var t = 0; t < Bio.CONFIG.SPORE_REVIVAL_WINDOW_TURNS; t++) {
    var changes = Bio.tickSporeTimers(state, board);
  }
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].result, 'REVIVED');
  assert.strictEqual(state.stoneMeta['f1'].state, Bio.STATE.ACTIVE);
});

test('孢子被抗真菌干扰命中后即使有相邻活真菌也不会复苏', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  state.stoneMeta['f1'] = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  state.stoneMeta['f1'].state = Bio.STATE.SPORE;
  state.sporeMarkers['f1'] = { originOwner: 'black', color: 'black', pos: [0, 0], turnsElapsed: 0, interfered: false };

  Bio.attemptAntifungalInterference(state, 'white', 'f1');
  assert.strictEqual(state.sporeMarkers['f1'].interfered, true);

  var activeFungiNeighbor = Bio.createStoneMeta(Bio.FACTION.FUNGI, 3, 'black');
  var board = makeMockBoard({ '1,0': activeFungiNeighbor }, { '0,0': [[1, 0]] });

  var changes;
  for (var t = 0; t < Bio.CONFIG.SPORE_REVIVAL_WINDOW_TURNS; t++) {
    changes = Bio.tickSporeTimers(state, board);
  }
  assert.strictEqual(changes[0].result, 'PERMANENT_DEAD_POINT');
});

// ---------------------------------------------------------------
// 二分裂
// ---------------------------------------------------------------

test('气数不足3时二分裂被拒绝', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  var rng = makeSeqRng([0]);
  var r = Bio.attemptDivision(state, 'black', { liberties: [[1, 1], [1, 2]] }, 'g1', 5, rng);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'NOT_ENOUGH_LIBERTIES');
});

test('二分裂成功后进入冷却，冷却期内再次触发应被拒绝', function () {
  var state = Bio.createInitialBioState(['black', 'white']);
  var rng = makeSeqRng([0]);
  var group = { liberties: [[1, 1], [1, 2], [1, 3]] };

  var r1 = Bio.attemptDivision(state, 'black', group, 'g1', 5, rng);
  assert.strictEqual(r1.ok, true);
  Bio.registerDivisionUsed(state, 'g1', 5);

  var r2 = Bio.attemptDivision(state, 'black', group, 'g1', 6, rng);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'ON_COOLDOWN');

  var r3 = Bio.attemptDivision(state, 'black', group, 'g1', 5 + Bio.CONFIG.DIVISION_COOLDOWN_TURNS, rng);
  assert.strictEqual(r3.ok, true);
});

// ---------------------------------------------------------------
// 序列化往返
// ---------------------------------------------------------------

test('序列化再反序列化应还原出等价的棋子元数据', function () {
  var meta = Bio.createStoneMeta(Bio.FACTION.VIRUS, 1, 'black');
  meta.infectionCount = 2;
  meta.state = Bio.STATE.INFECTED;
  var json = Bio.serializeStoneMeta(meta);
  var restored = Bio.deserializeStoneMeta(json, 'black');
  assert.strictEqual(restored.faction, meta.faction);
  assert.strictEqual(restored.tier, meta.tier);
  assert.strictEqual(restored.infectionCount, meta.infectionCount);
  assert.strictEqual(restored.state, meta.state);
});

// ---------------------------------------------------------------

console.log('\n' + results.pass + ' passed, ' + results.fail + ' failed');
if (results.fail > 0) {
  process.exitCode = 1;
}
