const WebSocket = require('ws');
const http = require('http');
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// 存储房间和玩家信息
const rooms = {};
const players = {};

// WebSocket连接逻辑
wss.on('connection', (ws) => {
  console.log('新客户端连接');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('收到消息：', message.type);

      // 简单处理核心消息（适配前端）
      switch (message.type) {
        case 'joinGame':
          // 模拟加入房间
          if (!rooms[message.roomId]) rooms[message.roomId] = [];
          if (!players[message.playerId]) players[message.playerId] = { name: `玩家${Math.random().toString(36).slice(2, 6)}`, role: '平民' };
          ws.send(JSON.stringify({ type: 'myRole', role: '平民', faction: 'civilian', playerName: players[message.playerId].name }));
          break;
        case 'chatMessage':
          // 广播聊天消息
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'chatMessage', playerName: message.playerName, message: message.message }));
            }
          });
          break;
        case 'requestPerspective':
          // 模拟透视功能
          const perspectivePlayers = Object.values(players).map(p => ({ name: p.name, role: p.role }));
          ws.send(JSON.stringify({ type: 'perspectiveResult', players: perspectivePlayers }));
          break;
        default:
          // 其他消息默认返回成功
          ws.send(JSON.stringify({ type: 'success', message: '操作成功' }));
      }
    } catch (err) {
      console.error('消息处理错误：', err);
      ws.send(JSON.stringify({ type: 'error', message: '服务器错误' }));
    }
  });

  ws.on('close', () => {
    console.log('客户端断开连接');
  });
});

// 监听端口（适配部署平台的环境变量）
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
