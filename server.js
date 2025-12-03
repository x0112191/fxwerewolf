const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

// 房间存储：key=房间号，value=房间信息
const rooms = {};

// 玩家存储：key=用户名，value=连接
const players = {};

wss.on('connection', (ws) => {
  console.log('新连接建立');

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    // 移除玩家
    for (const username in players) {
      if (players[username] === ws) {
        leaveRoom(username);
        delete players[username];
        break;
      }
    }
    console.log('连接关闭');
  });
});

// 处理客户端消息
function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'createRoom':
      createRoom(ws, msg);
      break;
    case 'joinRoom':
      joinRoom(ws, msg);
      break;
    case 'chatMessage':
      broadcastChat(msg);
      break;
    case 'voiceMessage':
      broadcastVoice(msg);
      break;
    case 'updateRules':
      updateRoomRules(msg);
      break;
    case 'startGame':
      startGame(msg);
      break;
    case 'enterGame':
      enterGame(ws, msg);
      break;
    case 'campaignSheriff':
      campaignSheriff(msg);
      break;
    case 'withdrawSheriff':
      withdrawSheriff(msg);
      break;
  }
}

// 创建房间
function createRoom(ws, msg) {
  const { roomId, username, key } = msg;
  if (rooms[roomId]) {
    ws.send(JSON.stringify({ type: 'error', message: '房间已存在！' }));
    return;
  }

  // 初始化房间（7-20人，仅自定义模式）
  rooms[roomId] = {
    host: username,
    key,
    players: [{ username, ws, isSelf: true }],
    maxPlayers: 20,
    minPlayers: 7,
    selectedRoles: [], // 房主选择的角色
    isGameStart: false,
    isNight: false,
    currentSpeaker: '',
    speakOrder: [], // 发言顺序
    sheriffCampaigners: [], // 警长竞选者
    voiceRemain: 3 // 语音剩余条数
  };

  players[username] = ws;
  ws.send(JSON.stringify({
    type: 'hostInfo',
    currentRules: {
      maxPlayers: 20,
      daySpeakTime: 90,
      lastWordTime: 20,
      canWolfKillFirstNight: true
    }
  }));

  // 通知创建成功
  ws.send(JSON.stringify({
    type: 'playerJoin',
    playerCount: 1,
    username,
    is
