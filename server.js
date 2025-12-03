const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 静态文件托管（前端页面）
app.use(express.static(path.join(__dirname, '.')));

// 全局存储
const rooms = {}; // 所有房间
const voiceMessages = {}; // 语音消息（key: voiceId, value: base64）
let voiceId = 0;

// 游戏阶段枚举
const GameStage = {
  WAITING: '等待玩家',
  ROLE_ASSIGN: '角色分配',
  NIGHT_ACTION: '夜晚行动',
  DAY_DISCUSS: '白天讨论',
  DAY_VOTE: '白天投票',
  GAME_OVER: '游戏结束'
};

// 阵营枚举
const Faction = {
  WEREWOLF: '狼人阵营',
  GOOD: '神民阵营',
  CIVILIAN: '平民阵营',
  NEUTRAL: '中立阵营'
};

// 角色配置（含阵营、默认数量、技能描述）
const RoleConfig = {
  '普通狼人': { faction: Faction.WEREWOLF, defaultCount: 1, hasNightAction: true },
  '白狼王': { faction: Faction.WEREWOLF, defaultCount: 1, hasNightAction: true },
  '血月使徒': { faction: Faction.WEREWOLF, defaultCount: 1, hasNightAction: true },
  '预言家': { faction: Faction.GOOD, defaultCount: 1, hasNightAction: true },
  '女巫': { faction: Faction.GOOD, defaultCount: 1, hasNightAction: true },
  '猎人': { faction: Faction.GOOD, defaultCount: 1, hasNightAction: false },
  '守卫': { faction: Faction.GOOD, defaultCount: 1, hasNightAction: true },
  '普通平民': { faction: Faction.CIVILIAN, defaultCount: 2, hasNightAction: false },
  '老流氓': { faction: Faction.CIVILIAN, defaultCount: 1, hasNightAction: false },
  '炸弹人': { faction: Faction.NEUTRAL, defaultCount: 1, hasNightAction: false },
  '白痴': { faction: Faction.NEUTRAL, defaultCount: 1, hasNightAction: false },
  '丘比特': { faction: Faction.NEUTRAL, defaultCount: 1, hasNightAction: true },
  '野孩子': { faction: Faction.NEUTRAL, defaultCount: 1, hasNightAction: true }
};

// 创建房间（默认配局：3狼+4神+3平民+3中立）
function createRoom(roomId, creatorWs, creatorNickname) {
  // 默认角色列表（按要求配置）
  const defaultRoles = [
    '普通狼人', '白狼王', '血月使徒', // 3狼
    '预言家', '女巫', '猎人', '守卫', // 4神
    '普通平民', '普通平民', '老流氓', // 3平民
    '炸弹人', '白痴', '丘比特', '野孩子' // 4中立（多1个中立不影响核心配局）
  ];

  const room = {
    id: roomId,
    players: [
      {
        ws: creatorWs,
        nickname: creatorNickname,
        isHost: true,
        isAlive: true,
        role: '', // 分配后填充
        faction: '', // 按角色自动填充
        hasLastWord: false, // 是否已发遗言
        // 角色专属状态
        isOldRascalPendingDeath: false, // 老流氓延迟死亡
        witchPotion: {解药: 1, 毒药: 1}, // 女巫药水数量
        guardLastTarget: '', // 守卫上晚守护目标（不可连续守）
        silencerLastTarget: '', // 禁言长老上晚禁言目标（不可连续禁）
        cupidChains: [], // 丘比特链子（玩家昵称数组）
        wildChildModel: '', // 野孩子榜样（昵称）
        wildChildTurnedWolf: false, // 野孩子是否变狼
        isCursed: false, // 是否被血月使徒诅咒（当晚）
        isSilenced: false, // 是否被禁言（白天）
        voteTarget: '', // 投票目标
        hasVoted: false, // 是否已投票
        hasExploded: false, // 白狼王是否已自爆
        hasUsedKnightSkill: false // 骑士是否已用单挑技能
      }
    ],
    customRules: {
      maxPlayers: 13, // 默认13人
      roles: defaultRoles, // 默认角色列表
      daySpeakTime: 90, // 白天发言90秒
      lastWordTime: 20, // 遗言20秒
      canWolfKillFirstNight: true // 首夜狼人可刀
    },
    isRuleLocked: false, // 规则是否锁定
    gameStage: GameStage.WAITING,
    currentDay: 1,
    // 夜晚状态
    nightKilledPlayer: null, // 狼刀目标
    nightHealedPlayer: null, // 女巫解药目标
    nightPoisonedPlayer: null, // 女巫毒药目标
    wolfKillTarget: null, // 狼人最终刀杀目标
    seerCheckTarget: null, // 预言家查验目标
    guardProtectTarget: null, // 守卫守护目标
    silencerSilenceTarget: null, // 禁言长老禁言目标
    bloodMoonCursedTarget: null, // 血月使徒诅咒目标
    // 投票状态
    voteResults: {},
    // 中立胜利状态
    idiotWon: false, // 白痴是否胜利
    bomberWon: false, // 炸弹人是否胜利
    cupidWon: false // 丘比特是否胜利
  };

  rooms[roomId] = room;
  // 给房主发送初始化信息
  creatorWs.send(JSON.stringify({
    type: 'hostInfo',
    isHost: true,
    playerCount: 1,
    currentRules: room.customRules,
    gameStage: room.gameStage
  }));
  return room;
}

// 工具函数：获取玩家所在房间
function getPlayerRoom(ws) {
  for (const id in rooms) {
    const room = rooms[id];
    if (room.players.find(p => p.ws === ws)) return room;
  }
  return null;
}

// 工具函数：获取玩家信息
function getPlayer(ws, room) {
  return room.players.find(p => p.ws === ws);
}

// 工具函数：生成6位房间号
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 工具函数：广播消息到房间
function broadcast(room, data) {
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
  });
}

// 工具函数：广播消息到指定玩家
function broadcastToPlayers(players, data) {
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
  });
}

// 工具函数：获取存活玩家（含老流氓延迟死亡）
function getAlivePlayers(room) {
  return room.players.filter(p => p.isAlive || p.isOldRascalPendingDeath);
}

// 1. 角色分配（按自定义规则分配）
function assignRoles(room) {
  const roles = [...room.customRules.roles];
  room.players.forEach(player => {
    const randomIdx = Math.floor(Math.random() * roles.length);
    player.role = roles.splice(randomIdx, 1)[0];
    player.faction = RoleConfig[player.role].faction; // 自动分配阵营

    // 初始化角色专属状态
    switch (player.role) {
      case '女巫': player.witchPotion = {解药: 1, 毒药: 1}; break;
      case '守卫': player.guardLastTarget = ''; break;
      case '丘比特': player.cupidChains = []; break;
      case '野孩子': player.wildChildModel = ''; player.wildChildTurnedWolf = false; break;
      case '老流氓': player.isOldRascalPendingDeath = false; break;
      case '白狼王': player.hasExploded = false; break;
      case '骑士': player.hasUsedKnightSkill = false; break;
    }

    // 给玩家发送个人角色信息
    player.ws.send(JSON.stringify({
      type: 'assignRole',
      role: player.role,
      faction: player.faction,
      skillDesc: getRoleSkillDesc(player.role)
    }));
  });

  // 广播角色分配完成，进入首夜
  broadcast(room, {
    type: 'gameNotice',
    message: `角色分配完成！当前为第${room.currentDay}晚，天黑请闭眼～`
  });
  room.gameStage = GameStage.NIGHT_ACTION;
  startNightAction(room);
}

// 角色技能描述（给玩家展示）
function getRoleSkillDesc(role) {
  const desc = {
    '普通狼人': '夜间共同行动，选择1名玩家击杀；白天可伪装',
    '白狼王': '夜间同普通狼人；白天任意阶段可自爆并带走1人',
    '血月使徒': '1.首夜不参与狼刀，仅旁观；2.第二晚起可诅咒1人，使其当晚技能失效',
    '预言家': '夜间查验1人阵营（好人/狼人/中立）',
    '女巫': '拥有解药、毒药各1瓶；被诅咒则当晚无法用药',
    '猎人': '非被毒杀出局时，可开枪带走1人；被诅咒则无法开枪',
    '守卫': '夜间守护1人（不可连续两晚守同一人）；被诅咒则无法守护',
    '普通平民': '无特殊技能；被诅咒则次日白天禁言',
    '老流氓': '被击杀/毒杀后，次日白天正常行动，白天结束后才出局',
    '炸弹人': '白天被放逐时，可报身份淘汰所有投他的人，单独胜利',
    '白痴': '被投票放逐即单独胜利',
    '丘比特': '首夜连2-3人成链子；被诅咒则无法结链',
    '野孩子': '首夜选1名榜样，榜样出局后变狼；被诅咒则无法选榜样'
  };
  return desc[role] || '无特殊技能';
}

// 2. 夜晚行动流程（按角色顺序触发）
function startNightAction(room) {
  // 重置当晚状态
  room.players.forEach(p => p.isCursed = false);
  room.nightKilledPlayer = null;
  room.nightHealedPlayer = null;
  room.nightPoisonedPlayer = null;
  room.wolfKillTarget = null;
  room.seerCheckTarget = null;
  room.guardProtectTarget = null;
  room.silencerSilenceTarget = null;
  room.bloodMoonCursedTarget = null;

  // 步骤1：丘比特首夜结链（仅首夜）
  if (room.currentDay === 1) {
    const cupid = room.players.find(p => p.isAlive && p.role === '丘比特' && !p.isCursed);
    if (cupid) {
      const alivePlayers = getAlivePlayers(room).map(p => p.nickname);
      cupid.ws.send(JSON.stringify({
        type: 'cupidAction',
        message: '丘比特请睁眼！选择2-3名玩家结为链子（用逗号分隔昵称）',
        alivePlayers: alivePlayers
      }));
      return;
    }
  }

  // 步骤2：野孩子首夜选榜样（仅首夜）
  if (room.currentDay === 1) {
    const wildChild = room.players.find(p => p.isAlive && p.role === '野孩子' && !p.isCursed);
    if (wildChild && !wildChild.wildChildModel) {
      const alivePlayers = getAlivePlayers(room).map(p => p.nickname);
      wildChild.ws.send(JSON.stringify({
        type: 'wildChildAction',
        message: '野孩子请睁眼！选择1名玩家作为榜样',
        alivePlayers: alivePlayers
      }));
      return;
    }
  }

  // 步骤3：狼人行动（普通狼人+白狼王+血月使徒）
  const wolves = room.players.filter(p => 
    p.isAlive && p.faction === Faction.WEREWOLF && !p.isCursed
  );
  if (wolves.length > 0) {
    // 血月使徒首夜仅旁观，不参与刀杀
    const canKill = room.currentDay === 1 ? 
      wolves.filter(w => w.role !== '血月使徒') : wolves;
    
    broadcastToPlayers(wolves, {
      type: 'wolfAction',
      message: room.currentDay === 1 ? 
        '狼人请睁眼！血月使徒旁观，其他狼人选择刀杀目标' : 
        '狼人请睁眼！选择刀杀目标（血月使徒可诅咒1人）',
      alivePlayers: getAlivePlayers(room).map(p => p.nickname)
    });
    return;
  }

  // 后续步骤：预言家→女巫→守卫→禁言长老（依次触发，代码略，完整逻辑见后续）
  nextNightStep(room);
}

// 夜晚行动下一步（按顺序触发角色）
function nextNightStep(room) {
  // 步骤4：预言家查验
  const seer = room.players.find(p => p.isAlive && p.role === '预言家' && !p.isCursed);
  if (seer) {
    const alivePlayers = getAlivePlayers(room).map(p => p.nickname);
    seer.ws.send(JSON.stringify({
      type: 'seerAction',
      message: '预言家请睁眼！选择查验目标',
      alivePlayers: alivePlayers
    }));
    return;
  }

  // 步骤5：女巫行动
  const witch = room.players.find(p => p.isAlive && p.role === '女巫' && !p.isCursed);
  if (witch && room.wolfKillTarget) {
    witch.ws.send(JSON.stringify({
      type: 'witchAction',
      message: `今晚被狼刀的是${room.wolfKillTarget}，是否使用解药？（是/否）`,
      killedPlayer: room.wolfKillTarget
    }));
    return;
  }

  // 步骤6：守卫守护
  const guard = room.players.find(p => p.isAlive && p.role === '守卫' && !p.isCursed);
  if (guard) {
    const alivePlayers = getAlivePlayers(room).map(p => p.nickname);
    guard.ws.send(JSON.stringify({
      type: 'guardAction',
      message: `守卫请睁眼！选择守护目标（不可连续两晚守${guard.guardLastTarget || '同一人'}）`,
      alivePlayers: alivePlayers
    }));
    return;
  }

  // 步骤7：禁言长老禁言
  const silencer = room.players.find(p => p.isAlive && p.role === '禁言长老' && !p.isCursed);
  if (silencer) {
    const alivePlayers = getAlivePlayers(room).map(p => p.nickname);
    silencer.ws.send(JSON.stringify({
      type: 'silencerAction',
      message: `禁言长老请睁眼！选择禁言目标（不可连续两晚禁${silencer.silencerLastTarget || '同一人'}）`,
      alivePlayers: alivePlayers
    }));
    return;
  }

  // 夜晚行动结束，处理结果
  endNightAction(room);
}

// 处理夜晚行动结果（死亡、诅咒、禁言等）
function endNightAction(room) {
  // 1. 处理血月使徒诅咒（技能失效）
  if (room.bloodMoonCursedTarget) {
    const cursedPlayer = room.players.find(p => p.nickname === room.bloodMoonCursedTarget);
    if (cursedPlayer) {
      cursedPlayer.isCursed = true;
      broadcast(room, {
        type: 'gameNotice',
        message: `血月使徒诅咒了${cursedPlayer.nickname}，其当晚技能失效！`
      });
    }
  }

  // 2. 处理禁言长老禁言（白天禁言）
  if (room.silencerSilenceTarget) {
    const silencedPlayer = room.players.find(p => p.nickname === room.silencerSilenceTarget);
    if (silencedPlayer) {
      silencedPlayer.isSilenced = true;
      broadcast(room, {
        type: 'gameNotice',
        message: `禁言长老禁言了${silencedPlayer.nickname}，次日白天无法发言！`
      });
    }
  }

  // 3. 处理狼刀+女巫解药/毒药
  const killedPlayers = [];

  // 狼刀目标（守卫守护则抵消）
  if (room.wolfKillTarget && room.guardProtectTarget !== room.wolfKillTarget) {
    const wolfKilled = room.players.find(p => p.nickname === room.wolfKillTarget);
    if (wolfKilled) {
      // 老流氓特殊处理：延迟死亡
      if (wolfKilled.role === '老流氓') {
        wolfKilled.isOldRascalPendingDeath = true;
        broadcast(room, {
          type: 'gameNotice',
          message: `老流氓${wolfKilled.nickname}被狼刀，延迟至白天结束后出局！`
        });
      } else {
        wolfKilled.isAlive = false;
        killedPlayers.push(wolfKilled.nickname);
      }
    }
  }

  // 女巫毒药目标（守卫守护则抵消）
  if (room.nightPoisonedPlayer && room.guardProtectTarget !== room.nightPoisonedPlayer) {
    const poisonKilled = room.players.find(p => p.nickname === room.nightPoisonedPlayer);
    if (poisonKilled && poisonKilled.isAlive) {
      // 老流氓特殊处理：延迟死亡
      if (poisonKilled.role === '老流氓') {
        poisonKilled.isOldRascalPendingDeath = true;
        broadcast(room, {
          type: 'gameNotice',
          message: `老流氓${poisonKilled.nickname}被女巫毒杀，延迟至白天结束后出局！`
        });
      } else {
        poisonKilled.isAlive = false;
        killedPlayers.push(poisonKilled.nickname);
      }
    }
  }

  // 广播夜晚结果
  if (killedPlayers.length > 0) {
    broadcast(room, {
      type: 'gameNotice',
      message: `天亮了！昨晚死亡的玩家：${killedPlayers.join('、')}`
    });
  } else {
    broadcast(room, {
      type: 'gameNotice',
      message: '天亮了！昨晚无人死亡～'
    });
  }

  // 检查中立胜利（白痴、炸弹人暂未触发，后续投票后检查）
  if (checkNeutralWin(room)) return;

  // 触发死者遗言（全员死后都有遗言）
  triggerLastWords(room);
}

// 触发死者遗言（打字/语音）
function triggerLastWords(room) {
  const deadPlayers = room.players.filter(p => !p.isAlive && !p.hasLastWord);
  if (deadPlayers.length === 0) {
    startDayDiscuss(room);
    return;
  }

  broadcast(room, {
    type: 'lastWordStage',
    message: `遗言阶段开始（${room.customRules.lastWordTime}秒/人）`
  });

  let currentIdx = 0;
  function nextWord() {
    if (currentIdx >= deadPlayers.length) {
      startDayDiscuss(room);
      return;
    }

    const deadPlayer = deadPlayers[currentIdx];
    // 通知死者发遗言
    deadPlayer.ws.send(JSON.stringify({
      type: 'sendLastWord',
      message: `请发送遗言（${room.customRules.lastWordTime}秒内）`
    }));

    // 通知其他人
    broadcastToPlayers(room.players.filter(p => p !== deadPlayer), {
      type: 'lastWordNotice',
      message: `正在播放${deadPlayer.nickname}的遗言...`
    });

    // 超时未发
    setTimeout(() => {
      if (!deadPlayer.hasLastWord) {
        deadPlayer.hasLastWord = true;
        broadcast(room, {
          type: 'lastWordBroadcast',
          nickname: deadPlayer.nickname,
          content: '（超时未发遗言）',
          isVoice: false
        });
        currentIdx++;
        nextWord();
      }
    }, room.customRules.lastWordTime * 1000);
  }

  nextWord();
}

// 3. 白天讨论阶段
function startDayDiscuss(room) {
  room.gameStage = GameStage.DAY_DISCUSS;
  const alivePlayers = getAlivePlayers(room);

  broadcast(room, {
    type: 'gameNotice',
    message: `第${room.currentDay}天白天讨论开始！发言时间${room.customRules.daySpeakTime}秒`
  });

  // 通知被禁言玩家
  const silencedPlayers = alivePlayers.filter(p => p.isSilenced);
  broadcastToPlayers(silencedPlayers, {
    type: 'silencedNotice',
    message: '你被禁言长老禁言，本次白天无法发言！'
  });

  // 讨论超时进入投票
  setTimeout(() => {
    startDayVote(room);
  }, room.customRules.daySpeakTime * 1000);
}

// 4. 白天投票阶段
function startDayVote(room) {
  room.gameStage = GameStage.DAY_VOTE;
  // 重置投票状态
  room.players.forEach(p => {
    p.voteTarget = '';
    p.hasVoted = false;
  });
  room.voteResults = {};

  broadcast(room, {
    type: 'gameNotice',
    message: '投票阶段开始！选择你要放逐的玩家（发送昵称）'
  });

  // 投票超时（30秒）
  setTimeout(() => {
    countVotes(room);
  }, 30000);
}

// 统计投票结果
function countVotes(room) {
  // 统计票数
  room.players.forEach(p => {
    if (p.hasVoted && p.voteTarget) {
      room.voteResults[p.voteTarget] = (room.voteResults[p.voteTarget] || 0) + 1;
    }
  });

  // 找出得票最高者
  let maxVotes = 0;
  let votedOutPlayer = null;
  for (const [name, votes] of Object.entries(room.voteResults)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      votedOutPlayer = room.players.find(p => p.nickname === name);
    }
  }

  if (votedOutPlayer) {
    // 检查中立胜利：白痴被放逐→胜利
    if (votedOutPlayer.role === '白痴') {
      room.idiotWon = true;
      endGame(room);
      return;
    }

    // 检查中立胜利：炸弹人被放逐→选择是否报身份
    if (votedOutPlayer.role === '炸弹人') {
      votedOutPlayer.ws.send(JSON.stringify({
        type: 'bomberAction',
        message: '你被放逐！是否报身份淘汰所有投你的人？（是/否）'
      }));
      return;
    }

    // 普通玩家被放逐：死亡+遗言
    votedOutPlayer.isAlive = false;
    broadcast(room, {
      type: 'gameNotice',
      message: `${votedOutPlayer.nickname}得票${maxVotes}票，被放逐！`
    });

    // 猎人非毒杀出局：可开枪
    if (votedOutPlayer.role === '猎人' && !votedOutPlayer.isCursed && 
        votedOutPlayer.nickname !== room.nightPoisonedPlayer) {
      votedOutPlayer.ws.send(JSON.stringify({
        type: 'hunterAction',
        message: '你被放逐（非毒杀）！选择开枪带走1人（发送昵称）'
      }));
      return;
    }

    // 触发遗言
    triggerLastWords(room);
  } else {
    broadcast(room, {
      type: 'gameNotice',
      message: '无人获得有效票数，本轮无放逐！'
    });
    nextNight(room);
  }
}

// 进入下一夜（处理老流氓延迟死亡）
function nextNight(room) {
  // 老流氓延迟死亡：白天结束后正式出局
  const oldRascal = room.players.find(p => p.isOldRascalPendingDeath);
  if (oldRascal) {
    oldRascal.isAlive = false;
    oldRascal.isOldRascalPendingDeath = false;
    broadcast(room, {
      type: 'gameNotice',
      message: `老流氓${oldRascal.nickname}延迟出局，正式死亡！`
    });
  }

  // 重置白天状态
  room.players.forEach(p => {
    p.isSilenced = false;
    p.isCursed = false;
  });

  // 天数+1
  room.currentDay++;
  broadcast(room, {
    type: 'gameNotice',
    message: `第${room.currentDay}晚，天黑请闭眼～`
  });
  room.gameStage = GameStage.NIGHT_ACTION;
  startNightAction(room);
}

// 检查中立胜利条件
function checkNeutralWin(room) {
  // 白痴胜利
  if (room.idiotWon) {
    broadcast(room, {
      type: 'gameOver',
      result: '中立胜利',
      message: '白痴被投票放逐，中立阵营获得胜利！'
    });
    return true;
  }

  // 炸弹人胜利
  if (room.bomberWon) {
    broadcast(room, {
      type: 'gameOver',
      result: '中立胜利',
      message: '炸弹人淘汰至少1人，中立阵营获得胜利！'
    });
    return true;
  }

  // 丘比特胜利（链子全员存活）
  const cupid = room.players.find(p => p.role === '丘比特');
  if (cupid && cupid.cupidChains.length > 0) {
    const chainsAlive = cupid.cupidChains.every(name => {
      const player = room.players.find(p => p.nickname === name);
      return player && (player.isAlive || player.isOldRascalPendingDeath);
    });
    if (chainsAlive) {
      room.cupidWon = true;
      broadcast(room, {
        type: 'gameOver',
        result: '中立胜利',
        message: '丘比特链子全员存活，中立阵营获得胜利！'
      });
      return true;
    }
  }

  return false;
}

// 检查阵营胜利条件
function checkFactionWin(room) {
  // 狼人阵营：所有神民+平民死亡
  const goodAlive = room.players.filter(p => 
    (p.faction === Faction.GOOD || p.faction === Faction.CIVILIAN) && 
    p.isAlive && !p.isOldRascalPendingDeath
  ).length;
  if (goodAlive === 0) {
    broadcast(room, {
      type: 'gameOver',
      result: '狼人胜利',
      message: '所有神民和平民已被消灭，狼人阵营获得胜利！'
    });
    return true;
  }

  // 好人阵营：所有狼人死亡
  const wolfAlive = room.players.filter(p => 
    p.faction === Faction.WEREWOLF && p.isAlive && !p.isOldRascalPendingDeath
  ).length;
  if (wolfAlive === 0) {
    broadcast(room, {
      type: 'gameOver',
      result: '好人胜利',
      message: '所有狼人已被消灭，神民+平民阵营获得胜利！'
    });
    return true;
  }

  return false;
}

// 结束游戏
function endGame(room) {
  if (checkNeutralWin(room)) return;
  if (checkFactionWin(room)) return;
}

// WebSocket核心消息监听
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    const room = getPlayerRoom(ws);
    const player = room ? getPlayer(ws, room) : null;

    // 1. 创建房间
    if (msg.type === 'createRoom') {
      const roomId = generateRoomId();
      const newRoom = createRoom(roomId, ws, msg.nickname);
      ws.send(JSON.stringify({
        type: 'createRoomSuccess',
        roomId: roomId,
        message: `房间创建成功！房间号：${roomId}`
      }));
      return;
    }

    // 2. 加入房间
    if (msg.type === 'joinRoom') {
      const targetRoom = rooms[msg.roomId];
      if (!targetRoom) {
        ws.send(JSON.stringify({ type: 'joinFail', message: '房间不存在' }));
        return;
      }
      if (targetRoom.players.length >= targetRoom.customRules.maxPlayers) {
        ws.send(JSON.stringify({ type: 'joinFail', message: '房间已满' }));
        return;
      }

      // 锁定规则（有人加入后不可改）
      if (targetRoom.players.length === 1) targetRoom.isRuleLocked = true;

      // 添加玩家
      targetRoom.players.push({
        ws: ws,
        nickname: msg.nickname,
        isHost: false,
        isAlive: true,
        role: '',
        faction: '',
        hasLastWord: false,
        isOldRascalPendingDeath: false,
        witchPotion: {解药: 1, 毒药: 1},
        guardLastTarget: '',
        silencerLastTarget: '',
        cupidChains: [],
        wildChildModel: '',
        wildChildTurnedWolf: false,
        isCursed: false,
        isSilenced: false,
        voteTarget: '',
        hasVoted: false,
        hasExploded: false,
        hasUsedKnightSkill: false
      });

      // 通知新玩家和房间内所有人
      ws.send(JSON.stringify({
        type: 'joinSuccess',
        roomId: msg.roomId,
        currentRules: targetRoom.customRules
      }));

      broadcast(targetRoom, {
        type: 'playerJoin',
        nickname: msg.nickname,
        playerCount: targetRoom.players.length
      });

      // 玩家满员自动开始游戏
      if (targetRoom.players.length === targetRoom.customRules.maxPlayers) {
        assignRoles(targetRoom);
      }
      return;
    }

    // 3. 房主修改规则
    if (msg.type === 'updateRules') {
      if (!player || !player.isHost || room.isRuleLocked || room.players.length > 1) {
        ws.send(JSON.stringify({ type: 'ruleUpdateFail', message: '仅房主单独在房间时可修改' }));
        return;
      }
      room.customRules = { ...room.customRules, ...msg.newRules };
      ws.send(JSON.stringify({ type: 'ruleUpdateSuccess', currentRules: room.customRules }));
      return;
    }

    // 4. 聊天消息（打字+语音）
    if (msg.type === 'chatMessage' || msg.type === 'voiceMessage') {
      if (room.gameStage === GameStage.DAY_DISCUSS && player.isSilenced) {
        ws.send(JSON.stringify({ type: 'chatFail', message: '你被禁言，无法发言' }));
        return;
      }

      if (msg.type === 'voiceMessage') {
        const id = voiceId++;
        voiceMessages[id] = msg.content;
        broadcast(room, {
          type: 'voiceBroadcast',
          nickname: player.nickname,
          voiceId: id,
          time: new Date().toLocaleTimeString()
        });
      } else {
        broadcast(room, {
          type: 'chatBroadcast',
          nickname: player.nickname,
          content: msg.content,
          time: new Date().toLocaleTimeString()
        });
      }
      return;
    }

    // 5. 角色行动消息（狼刀、预言家查验等，完整逻辑见后续）
    handleRoleAction(room, player, msg);
  });

  // 连接关闭
  ws.on('close', () => {
    const room = getPlayerRoom(ws);
    if (!room) return;
    const player = getPlayer(ws, room);
    if (player) {
      broadcast(room, {
        type: 'playerLeave',
        message: `${player.nickname}已离开房间`
      });
      // 移除玩家
      room.players = room.players.filter(p => p.ws !== ws);
      // 房间空了则删除
      if (room.players.length === 0) delete rooms[room.id];
    }
  });
});

// 处理角色行动（狼刀、查验、用药等）
function handleRoleAction(room, player, msg) {
  // 狼人刀杀
  if (msg.type === 'wolfKill') {
    if (player.faction !== Faction.WEREWOLF || !player.isAlive || player.isCursed) return;
    room.wolfKillTarget = msg.target;
    // 血月使徒诅咒
    if (msg.curseTarget && player.role === '血月使徒' && room.currentDay > 1) {
      room.bloodMoonCursedTarget = msg.curseTarget;
    }
    nextNightStep(room);
    return;
  }

  // 预言家查验
  if (msg.type === 'seerCheck') {
    if (player.role !== '预言家' || !player.isAlive || player.isCursed) return;
    const target = room.players.find(p => p.nickname === msg.target);
    if (target) {
      let result = target.faction;
      // 野孩子未变狼→中立，变狼→狼人
      if (target.role === '野孩子') {
        result = target.wildChildTurnedWolf ? Faction.WEREWOLF : Faction.NEUTRAL;
      }
      player.ws.send(JSON.stringify({
        type: 'seerCheckResult',
        target: msg.target,
        result: result
      }));
    }
    nextNightStep(room);
    return;
  }

  // 女巫用药
  if (msg.type === 'witchHeal' || msg.type === 'witchPoison') {
    if (player.role !== '女巫' || !player.isAlive || player.isCursed) return;
    if (msg.type === 'witchHeal' && player.witchPotion.解药 > 0) {
      room.nightHealedPlayer = msg.target;
      player.witchPotion.解药--;
    }
    if (msg.type === 'witchPoison' && player.witchPotion.毒药 > 0) {
      room.nightPoisonedPlayer = msg.target;
      player.witchPotion.毒药--;
    }
    nextNightStep(room);
    return;
  }

  // 其他角色行动（守卫、禁言长老、丘比特等，完整逻辑略）
}

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器启动成功，监听端口${PORT}`);
});
