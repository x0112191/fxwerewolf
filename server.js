// 导入所有必需依赖（确保package.json里有这些依赖）
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto'); // 内置模块，生成房间号用

// 初始化Express和HTTP服务器
const app = express();
const server = http.createServer(app);

// 核心配置1：托管所有前端文件（HTML、JS、CSS，让用户能访问页面）
app.use(express.static(__dirname));

// 核心配置2：访问域名根路径（比如 fxwerewolf.vercel.app）时，自动打开首页index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// WebSocket服务器绑定到HTTP服务器（共享同一个端口）
const wss = new WebSocket.Server({ server });

// 存储房间数据（房间ID → 房间信息）
const rooms = new Map();

// 生成随机4位房间号（纯数字，方便用户记忆）
function generateRoomId() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 生成角色列表（根据玩家人数分配狼人、村民等角色，按狼人杀常规规则）
function generateRoleList(playerCount) {
  const roles = [];
  const wolfCount = Math.floor(playerCount / 3); // 狼人数量 = 玩家数/3（向下取整）
  const seerCount = 1; // 预言家1名
  const witchCount = 1; // 女巫1名
  const hunterCount = 1; // 猎人1名
  const villagerCount = playerCount - wolfCount - seerCount - witchCount - hunterCount; // 剩余为村民

  // 添加狼人
  for (let i = 0; i < wolfCount; i++) roles.push('狼人');
  // 添加特殊角色
  roles.push('预言家', '女巫', '猎人');
  // 添加村民
  for (let i = 0; i < villagerCount; i++) roles.push('村民');
  // 打乱角色顺序（随机分配）
  return roles.sort(() => Math.random() - 0.5);
}

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

// 处理WebSocket连接
wss.on('connection', (ws) => {
  console.log('新玩家连接到服务器');

  // 存储当前玩家信息（连接后初始化）
  let currentPlayer = null;
  let currentRoomId = null;

  // 接收前端发送的消息
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data); // 解析前端发送的JSON消息
      console.log('收到消息:', message);

      // 根据消息类型处理不同逻辑
      switch (message.type) {
        // 1. 创建房间
        case 'createRoom': {
          const { playerName, roomPassword } = message;
          const roomId = generateRoomId(); // 生成唯一房间号
          currentRoomId = roomId;

          // 创建新玩家（房主）
          currentPlayer = {
            id: crypto.randomUUID(), // 生成唯一玩家ID
            name: playerName,
            isHost: true, // 创建者是房主
            ws: ws // 绑定当前WebSocket连接
          };

          // 创建新房间
          rooms.set(roomId, {
            id: roomId,
            password: roomPassword || '', // 房间密码（可选）
            players: [currentPlayer], // 房间内玩家列表
            host: currentPlayer.id, // 房主ID
            isGameStarted: false // 游戏是否已开始
          });

          // 回复前端：创建房间成功
          ws.send(JSON.stringify({
            type: 'roomCreated',
            success: true,
            roomId: roomId,
            playerId: currentPlayer.id,
            isHost: true
          }));

          // 广播房间内玩家列表更新（只有房主自己）
          broadcastToRoom(roomId, {
            type: 'playerListUpdate',
            players: rooms.get(roomId).players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          });
          break;
        }

        // 2. 加入房间
        case 'joinRoom': {
          const { roomId, playerName, roomPassword } = message;
          const room = rooms.get(roomId);

          // 检查房间是否存在
          if (!room) {
            ws.send(JSON.stringify({
              type: 'joinRoomResult',
              success: false,
              message: '房间不存在！'
            }));
            return;
          }

          // 检查房间是否已满（假设最多12人，可调整）
          if (room.players.length >= 12) {
            ws.send(JSON.stringify({
              type: 'joinRoomResult',
              success: false,
              message: '房间已满！'
            }));
            return;
          }

          // 检查房间密码是否正确
          if (room.password && room.password !== roomPassword) {
            ws.send(JSON.stringify({
              type: 'joinRoomResult',
              success: false,
              message: '密码错误！'
            }));
            return;
          }

          // 检查游戏是否已开始（已开始不能加入）
          if (room.isGameStarted) {
            ws.send(JSON.stringify({
              type: 'joinRoomResult',
              success: false,
              message: '游戏已开始，无法加入！'
            }));
            return;
          }

          // 创建新玩家（普通玩家）
          currentPlayer = {
            id: crypto.randomUUID(),
            name: playerName,
            isHost: false,
            ws: ws
          };
          currentRoomId = roomId;

          // 添加玩家到房间
          room.players.push(currentPlayer);

          // 回复前端：加入房间成功
          ws.send(JSON.stringify({
            type: 'joinRoomResult',
            success: true,
            roomId: roomId,
            playerId: currentPlayer.id,
            isHost: false
          }));

          // 广播房间内所有玩家：玩家列表更新
          broadcastToRoom(roomId, {
            type: 'playerListUpdate',
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          });
          break;
        }

        // 3. 房主开始游戏
        case 'startGame': {
          const { roomId } = message;
          const room = rooms.get(roomId);

          // 检查是否是房主
          if (room.host !== currentPlayer.id) {
            ws.send(JSON.stringify({
              type: 'startGameResult',
              success: false,
              message: '只有房主能开始游戏！'
            }));
            return;
          }

          // 检查玩家数量是否足够（最少4人）
          if (room.players.length < 4) {
            ws.send(JSON.stringify({
              type: 'startGameResult',
              success: false,
              message: '玩家数量不足4人，无法开始游戏！'
            }));
            return;
          }

          // 标记游戏已开始
          room.isGameStarted = true;

          // 生成角色列表并分配给每个玩家
          const roleList = generateRoleList(room.players.length);
          room.players.forEach((player, index) => {
            player.role = roleList[index]; // 给每个玩家分配角色
            // 单独给当前玩家发送他的角色（避免其他人看到）
            player.ws.send(JSON.stringify({
              type: 'assignRole',
              role: player.role
            }));
          });

          // 广播给所有玩家：游戏开始
          broadcastToRoom(roomId, {
            type: 'gameStarted',
            playerCount: room.players.length
          });
          break;
        }

        // 4. 聊天消息（玩家之间实时聊天）
        case 'chatMessage': {
          const { roomId, content } = message;
          const room = rooms.get(roomId);
          if (!room) return;

          // 广播聊天消息给房间内所有玩家
          broadcastToRoom(roomId, {
            type: 'newChatMessage',
            playerName: currentPlayer.name,
            content: content,
            time: new Date().toLocaleTimeString() // 消息时间
          });
          break;
        }

        // 5. 玩家离开房间
        case 'leaveRoom': {
          const { roomId, playerId } = message;
          const room = rooms.get(roomId);
          if (!room) return;

          // 移除当前玩家
          room.players = room.players.filter(p => p.id !== playerId);

          // 如果房主离开，重新选举第一个玩家为房主
          if (room.host === playerId && room.players.length > 0) {
            const newHost = room.players[0];
            room.host = newHost.id;
            newHost.isHost = true;

            // 广播房主变更
            broadcastToRoom(roomId, {
              type: 'hostChanged',
              newHostId: newHost.id,
              newHostName: newHost.name
            });
          }

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

          // 如果房间为空，删除房间
          if (room.players.length === 0) {
            rooms.delete(roomId);
          }

          // 重置当前玩家和房间信息
          currentPlayer = null;
          currentRoomId = null;
          break;
        }

        // 其他消息类型（默认忽略）
        default:
          console.log('未知消息类型:', message.type);
      }
    } catch (error) {
      console.error('解析消息失败:', error);
    }
  });

  // 处理玩家断开连接
  ws.on('close', () => {
    console.log('玩家断开连接');
    if (currentPlayer && currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        // 自动移除断开连接的玩家
        room.players = room.players.filter(p => p.id !== currentPlayer.id);

        // 重新选举房主（如果需要）
        if (room.host === currentPlayer.id && room.players.length > 0) {
          const newHost = room.players[0];
          room.host = newHost.id;
          newHost.isHost = true;
          broadcastToRoom(currentRoomId, {
            type: 'hostChanged',
            newHostId: newHost.id,
            newHostName: newHost.name
          });
        }

        // 广播玩家离开
        broadcastToRoom(currentRoomId, {
          type: 'playerLeft',
          playerId: currentPlayer.id,
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
          }))
        });

        // 房间为空则删除
        if (room.players.length === 0) {
          rooms.delete(currentRoomId);
        }
      }
    }
  });

  // 处理连接错误
  ws.on('error', (error) => {
    console.error('WebSocket错误:', error);
  });
});

// 监听端口（兼容Vercel自动分配的端口和本地测试端口）
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`服务器已启动，监听端口 ${port}`);
  console.log(`本地访问地址: http://localhost:${port}`);
  console.log(`公网访问地址: https://你的Vercel域名.vercel.app`);
});

});
