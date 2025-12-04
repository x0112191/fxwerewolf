const WebSocket = require('ws');
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);

// 适配 Vercel 部署：使用环境变量端口，兼容反向代理
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({
  server: server,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

// 引入游戏核心逻辑
const WerewolfGameLogic = require('./game_logic.js');

// 房间存储 { roomId: { id, players, gameState, createTime } }
const rooms = new Map();

// 广播消息到房间内所有玩家
function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// 生成角色列表（完善版）
function generateRoleList(roleConfig, playerCount) {
  const roleList = [];

  // 狼人阵营
  for (let i = 0; i < (roleConfig.normalWolf || 0); i++) roleList.push('普通狼人');
  for (let i = 0; i < (roleConfig.whiteWolf || 0); i++) roleList.push('白狼王');
  for (let i = 0; i < (roleConfig.werewolfKing || 0); i++) roleList.push('普通狼王');
  for (let i = 0; i < (roleConfig.bloodMoonApostle || 0); i++) roleList.push('血月使徒');

  // 神民阵营
  for (let i = 0; i < (roleConfig.seer || 0); i++) roleList.push('预言家');
  for (let i = 0; i < (roleConfig.witch || 0); i++) roleList.push('女巫');
  for (let i = 0; i < (roleConfig.hunter || 0); i++) roleList.push('猎人');
  for (let i = 0; i < (roleConfig.guard || 0); i++) roleList.push('守卫');
  for (let i = 0; i < (roleConfig.silencer || 0); i++) roleList.push('禁言长老');
  for (let i = 0; i < (roleConfig.knight || 0); i++) roleList.push('骑士');

  // 平民阵营
  for (let i = 0; i < (roleConfig.civilian || 0); i++) roleList.push('普通平民');
  for (let i = 0; i < (roleConfig.oldRogue || 0); i++) roleList.push('老流氓');

  // 中立阵营
  for (let i = 0; i < (roleConfig.bomber || 0); i++) roleList.push('炸弹人');
  for (let i = 0; i < (roleConfig.idiot || 0); i++) roleList.push('白痴');
  for (let i = 0; i < (roleConfig.cupid || 0); i++) roleList.push('丘比特');
  for (let i = 0; i < (roleConfig.wildChild || 0); i++) roleList.push('野孩子');

  // 随机打乱角色列表
  roleList.sort(() => Math.random() - 0.5);

  // 确保长度匹配（不足补普通平民）
  if (roleList.length < playerCount) {
    const need = playerCount - roleList.length;
    for (let i = 0; i < need; i++) roleList.push('普通平民');
  }

  return roleList.slice(0, playerCount);
}

// 广播游戏状态到房间所有玩家
function broadcastGameState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // 过滤敏感信息（仅自己可见角色）
  const safePlayers = room.gameState.players.map(p => ({
    id: p.id,
    name: p.name,
    isAlive: p.isAlive,
    playerNumber: p.playerNumber,
    role: '未知' // 前端自己的角色会单独发送
  }));

  const safeState = {
    roomId: room.id,
    gamePhase: room.gameState.gamePhase,
    day: room.gameState.day,
    players: safePlayers,
    winner: room.gameState.winner
  };

  // 广播公共状态
  broadcastToRoom(roomId, {
    type: 'gameState',
    data: safeState
  });

  // 单独给每个玩家发送自己的角色
  room.gameState.players.forEach(player => {
    const ws = room.players.find(p => p.id === player.id)?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'myRole',
        role: player.role,
        faction: player.faction
      }));
    }
  });
}

// 定时清理空房间/超时房间（每分钟检查）
setInterval(() => {
  rooms.forEach((room, roomId) => {
    // 1. 空房间直接删除
    if (room.players.length === 0) {
      rooms.delete(roomId);
      console.log(`清理空房间：${roomId}`);
      return;
    }

    // 2. 超过1小时未开始游戏的房间清理
    const createTime = room.createTime || Date.now();
    if (Date.now() - createTime > 3600000 && room.gameState.gamePhase === 'waiting') {
      broadcastToRoom(roomId, {
        type: 'roomExpired',
        message: '房间超时未开始游戏，已自动关闭'
      });
      rooms.delete(roomId);
      console.log(`清理超时房间：${roomId}`);
    }
  });
}, 60000);

// WebSocket 连接处理
wss.on('connection', (ws) => {
  console.log('新客户端连接');

  // 心跳检测（30秒一次）
  let heartbeatTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(heartbeatTimer);
      return;
    }
    ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
  }, 30000);

  // 消息处理
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('收到消息：', message.type);

      switch (message.type) {
        // 创建房间
        case 'createRoom':
          const roomId = Math.floor(1000 + Math.random() * 9000).toString();
          const password = message.password ? atob(message.password) : '';
          
          rooms.set(roomId, {
            id: roomId,
            password: password,
            players: [{
              id: message.playerId,
              name: message.playerName,
              ws: ws,
              isHost: true
            }],
            gameState: {
              roomId: roomId,
              players: [],
              gamePhase: 'waiting',
              day: 1,
              nightActions: {},
              voteRecords: {},
              skillUsageRecords: {},
              cupidPairs: [],
              winner: '',
              config: message.gameConfig || {
                speakTime: 120,
                firstNightKill: true,
                canRevive: false,
                wildChildTransform: true
              }
            },
            createTime: Date.now()
          });

          ws.send(JSON.stringify({
            type: 'createRoomSuccess',
            roomId: roomId,
            message: '房间创建成功'
          }));
          break;

        // 加入房间
        case 'joinRoom':
          const room = rooms.get(message.roomId);
          if (!room) {
            ws.send(JSON.stringify({
              type: 'joinRoomFailed',
              message: '房间不存在'
            }));
            break;
          }

          // 校验密码
          const inputPwd = message.password ? atob(message.password) : '';
          if (room.password && room.password !== inputPwd) {
            ws.send(JSON.stringify({
              type: 'joinRoomFailed',
              message: '房间密码错误'
            }));
            break;
          }

          // 检查房间是否已满
          if (room.players.length >= 20) {
            ws.send(JSON.stringify({
              type: 'joinRoomFailed',
              message: '房间人数已满'
            }));
            break;
          }

          // 添加玩家
          room.players.push({
            id: message.playerId,
            name: message.playerName,
            ws: ws,
            isHost: false
          });

          // 广播玩家加入
          broadcastToRoom(message.roomId, {
            type: 'playerJoined',
            player: {
              id: message.playerId,
              name: message.playerName
            },
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          });

          // 通知加入成功
          ws.send(JSON.stringify({
            type: 'joinRoomSuccess',
            roomId: message.roomId,
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          }));
          break;

        // 离开房间
        case 'leaveRoom':
          const leaveRoom = rooms.get(message.roomId);
          if (leaveRoom) {
            // 移除玩家
            leaveRoom.players = leaveRoom.players.filter(p => p.id !== message.playerId);
            
            // 广播玩家离开
            broadcastToRoom(message.roomId, {
              type: 'playerLeft',
              playerId: message.playerId,
              players: leaveRoom.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
              }))
            });

            // 空房间删除
            if (leaveRoom.players.length === 0) {
              rooms.delete(message.roomId);
            }
          }
          break;

        // 开始游戏
        case 'startGame':
          const gameRoom = rooms.get(message.roomId);
          if (!gameRoom) break;

          // 初始化游戏逻辑
          const gameLogic = new WerewolfGameLogic();
          const players = gameRoom.players.map(p => ({ id: p.id, name: p.name }));
          
          gameRoom.gameState = gameLogic.initGame(
            message.roomId,
            players,
            message.roleConfig,
            gameRoom.gameState.config
          );

          // 广播游戏开始
          broadcastGameState(message.roomId);
          
          broadcastToRoom(message.roomId, {
            type: 'gameStarted',
            message: '游戏开始！当前为第1夜'
          });
          break;

        // 夜晚行动
        case 'nightAction':
          const nightRoom = rooms.get(message.roomId);
          if (!nightRoom || nightRoom.gameState.gamePhase !== 'night') break;

          const nightLogic = new WerewolfGameLogic();
          nightLogic.gameState = { ...nightRoom.gameState };
          
          const nightResult = nightLogic.processNightPhase(message.actions);
          nightRoom.gameState = nightLogic.gameState;

          // 广播夜晚结果
          broadcastToRoom(message.roomId, {
            type: 'nightResult',
            result: nightResult
          });

          // 同步游戏状态
          broadcastGameState(message.roomId);
          break;

        // 投票
        case 'vote':
          const voteRoom = rooms.get(message.roomId);
          if (!voteRoom || voteRoom.gameState.gamePhase !== 'day') break;

          const voteLogic = new WerewolfGameLogic();
          voteLogic.gameState = { ...voteRoom.gameState };
          
          const voteResult = voteLogic.processVotePhase(message.voteRecords);
          voteRoom.gameState = voteLogic.gameState;

          // 广播投票结果
          broadcastToRoom(message.roomId, {
            type: 'voteResult',
            result: voteResult
          });

          // 同步游戏状态
          broadcastGameState(message.roomId);
          break;

        // 骑士决斗
        case 'knightDuel':
          const duelRoom = rooms.get(message.roomId);
          if (!duelRoom) break;

          const duelLogic = new WerewolfGameLogic();
          duelLogic.gameState = { ...duelRoom.gameState };
          
          const duelResult = duelLogic.processKnightDuel(message.knightId, message.targetId);
          duelRoom.gameState = duelLogic.gameState;

          // 广播决斗结果
          broadcastToRoom(message.roomId, {
            type: 'duelResult',
            result: duelResult
          });

          // 同步游戏状态
          broadcastGameState(message.roomId);
          break;

        // 透视请求
        case 'requestPerspective':
          const perspectiveRoom = rooms.get(message.roomId);
          if (perspectiveRoom && perspectiveRoom.gameState.started) {
            const requester = perspectiveRoom.players.find(p => p.id === message.playerId);
            if (requester) {
              requester.ws.send(JSON.stringify({
                type: 'perspectiveResult',
                players: perspectiveRoom.gameState.players.map(p => ({
                  id: p.id,
                  name: p.name,
                  role: p.role
                }))
              }));
            }
          }
          break;

        // 聊天消息
        case 'chatMessage':
          broadcastToRoom(message.roomId, {
            type: 'chatMessage',
            playerId: message.playerId,
            playerName: message.playerName || '未知玩家',
            message: message.message
          });
          break;

        // 心跳响应
        case 'heartbeat':
          // 忽略心跳响应
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: '未知消息类型'
          }));
      }
    } catch (err) {
      console.error('消息处理错误：', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: '消息格式错误'
      }));
    }
  });

  // 连接关闭
  ws.on('close', () => {
    clearInterval(heartbeatTimer);
    console.log('客户端断开连接');

    // 移除该玩家从所有房间
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex(p => p.ws === ws);
      if (playerIndex !== -1) {
        const playerId = room.players[playerIndex].id;
        
        // 移除玩家
        room.players.splice(playerIndex, 1);
        
        // 广播玩家离开
        broadcastToRoom(roomId, {
          type: 'playerLeft',
          playerId: playerId,
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
          }))
        });

        // 空房间删除
        if (room.players.length === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });

  // 连接错误
  ws.on('error', (err) => {
    console.error('WebSocket 错误：', err);
  });
});

// 静态文件服务
app.use(express.static('.'));

// 根路由
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 全局错误捕获
process.on('uncaughtException', (err) => {
  console.error('未捕获异常：', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝：', reason, promise);
});
