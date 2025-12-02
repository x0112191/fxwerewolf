const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 静态文件托管（Render需要，否则前端页面无法访问）
app.use(express.static(__dirname));

// 游戏房间存储（key：房间号，value：房间信息）
const rooms = new Map();

// 处理WebSocket连接
wss.on('connection', (ws) => {
    let currentRoom = null;
    let playerId = null;

    // 处理消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('收到消息:', data);

            switch(data.type) {
                // 创建房间
                case 'createRoom':
                    const roomId = data.roomId || Math.floor(100000 + Math.random() * 900000).toString();
                    const hostId = data.playerId;
                    
                    // 检查房间是否已存在
                    if (rooms.has(roomId)) {
                        ws.send(JSON.stringify({
                            type: 'createFailed',
                            reason: '房间已存在'
                        }));
                        return;
                    }

                    // 创建新房间
                    rooms.set(roomId, {
                        id: roomId,
                        host: hostId,
                        password: data.password || '',
                        gameMode: data.gameMode || 'standard',
                        players: [{
                            id: hostId,
                            name: data.playerName,
                            ws: ws,
                            isHost: true
                        }],
                        gameState: {
                            phase: 'waiting',
                            started: false,
                            roleConfig: {}
                        }
                    });
                    
                    currentRoom = roomId;
                    playerId = hostId;
                    
                    // 回复创建成功
                    ws.send(JSON.stringify({
                        type: 'roomCreated',
                        roomId: roomId,
                        isHost: true
                    }));
                    
                    // 广播房间内玩家列表更新
                    broadcastToRoom(roomId, {
                        type: 'playerListUpdate',
                        players: rooms.get(roomId).players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                    });
                    break;
                    
                // 加入房间
                case 'joinRoom':
                    const joinRoom = rooms.get(data.roomId);
                    if (!joinRoom) {
                        ws.send(JSON.stringify({
                            type: 'joinFailed',
                            reason: '房间不存在'
                        }));
                        return;
                    }

                    // 验证密码
                    if (joinRoom.password && joinRoom.password !== data.password) {
                        ws.send(JSON.stringify({
                            type: 'joinFailed',
                            reason: '密码错误'
                        }));
                        return;
                    }

                    // 检查房间是否已满
                    if (joinRoom.players.length >= 12) {
                        ws.send(JSON.stringify({
                            type: 'joinFailed',
                            reason: '房间已满'
                        }));
                        return;
                    }

                    // 检查玩家是否已在房间内
                    const isAlreadyInRoom = joinRoom.players.some(p => p.id === data.playerId);
                    if (isAlreadyInRoom) {
                        ws.send(JSON.stringify({
                            type: 'joinFailed',
                            reason: '你已在房间内'
                        }));
                        return;
                    }

                    // 加入房间
                    currentRoom = data.roomId;
                    playerId = data.playerId;
                    
                    joinRoom.players.push({
                        id: data.playerId,
                        name: data.playerName,
                        ws: ws,
                        isHost: false
                    });
                    
                    // 回复加入成功
                    ws.send(JSON.stringify({
                        type: 'joinedRoom',
                        roomId: joinRoom.id,
                        players: joinRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost})),
                        host: joinRoom.host
                    }));
                    
                    // 广播房间内其他玩家
                    broadcastToRoom(joinRoom.id, {
                        type: 'playerJoined',
                        players: joinRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost})),
                        joinedPlayer: {id: data.playerId, name: data.playerName}
                    });
                    
                    // 8人时触发房主选举（如果还没有房主）
                    if (joinRoom.players.length >= 8 && !joinRoom.host) {
                        const randomHostIndex = Math.floor(Math.random() * joinRoom.players.length);
                        const newHost = joinRoom.players[randomHostIndex];
                        joinRoom.host = newHost.id;
                        newHost.isHost = true;
                        
                        // 广播房主变更
                        broadcastToRoom(joinRoom.id, {
                            type: 'hostElected',
                            hostId: newHost.id,
                            hostName: newHost.name,
                            players: joinRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                        });
                    }
                    break;
                    
                // 选举房主（客户端触发）
                case 'electHost':
                    const electRoom = rooms.get(data.roomId);
                    if (!electRoom || electRoom.host === data.hostId) return;
                    
                    // 更新房主信息
                    electRoom.host = data.hostId;
                    electRoom.players.forEach(p => {
                        p.isHost = (p.id === data.hostId);
                    });
                    
                    // 广播房主变更
                    broadcastToRoom(electRoom.id, {
                        type: 'hostElected',
                        hostId: data.hostId,
                        hostName: electRoom.players.find(p => p.id === data.hostId).name,
                        players: electRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                    });
                    break;
                    
                // 提交角色配置
                case 'submitRoleConfig':
                    const configRoom = rooms.get(data.roomId);
                    if (!configRoom || configRoom.host !== data.playerId) return;
                    
                    // 保存角色配置
                    configRoom.gameState.roleConfig = data.roleConfig;
                    
                    // 广播角色配置完成
                    broadcastToRoom(configRoom.id, {
                        type: 'roleConfigSubmitted',
                        roleConfig: data.roleConfig
                    });
                    break;
                    
                // 开始游戏
                case 'startGame':
                    const gameRoom = rooms.get(data.roomId);
                    if (!gameRoom || gameRoom.host !== data.playerId) return;
                    
                    // 检查玩家数是否足够（至少8人）
                    if (gameRoom.players.length < 8) {
                        ws.send(JSON.stringify({
                            type: 'startFailed',
                            reason: '至少需要8名玩家才能开始游戏'
                        }));
                        return;
                    }
                    
                    // 检查角色配置是否存在
                    if (!Object.keys(gameRoom.gameState.roleConfig).length) {
                        ws.send(JSON.stringify({
                            type: 'startFailed',
                            reason: '请先配置角色'
                        }));
                        return;
                    }
                    
                    // 初始化游戏状态
                    gameRoom.gameState.started = true;
                    gameRoom.gameState.phase = 'night';
                    
                    // 分配角色
                    const roleList = generateRoleList(gameRoom.gameState.roleConfig, gameRoom.players.length);
                    const playersWithRoles = gameRoom.players.map((player, index) => ({
                        id: player.id,
                        name: player.name,
                        role: roleList[index],
                        isAlive: true
                    }));
                    gameRoom.gameState.players = playersWithRoles;
                    
                    // 给每个玩家发送自己的角色
                    gameRoom.players.forEach((player, index) => {
                        player.ws.send(JSON.stringify({
                            type: 'gameStarted',
                            role: roleList[index],
                            gameState: {
                                phase: gameRoom.gameState.phase,
                                started: true
                            }
                        }));
                    });
                    
                    // 广播游戏开始（不包含他人角色）
                    broadcastToRoom(gameRoom.id, {
                        type: 'gameStartedBroadcast',
                        gameState: {
                            phase: gameRoom.gameState.phase,
                            started: true,
                            playerCount: gameRoom.players.length
                        }
                    });
                    break;
                    
                // 离开房间
                case 'leaveRoom':
                    if (currentRoom && playerId) {
                        const leaveRoom = rooms.get(currentRoom);
                        if (leaveRoom) {
                            // 移除玩家
                            leaveRoom.players = leaveRoom.players.filter(p => p.id !== playerId);
                            
                            // 如果房主离开，重新选举房主（如果还有玩家）
                            if (leaveRoom.host === playerId && leaveRoom.players.length > 0) {
                                leaveRoom.host = leaveRoom.players[0].id;
                                leaveRoom.players[0].isHost = true;
                                
                                // 广播新房主
                                broadcastToRoom(leaveRoom.id, {
                                    type: 'hostElected',
                                    hostId: leaveRoom.host,
                                    hostName: leaveRoom.players[0].name,
                                    players: leaveRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                                });
                            } else {
                                // 广播玩家离开
                                broadcastToRoom(leaveRoom.id, {
                                    type: 'playerLeft',
                                    playerId: playerId,
                                    players: leaveRoom.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                                });
                            }
                            
                            // 如果房间为空，删除房间
                            if (leaveRoom.players.length === 0) {
                                rooms.delete(currentRoom);
                            }
                        }
                    }
                    break;
                    
                // 发送聊天消息
                case 'chatMessage':
                    if (currentRoom) {
                        const chatRoom = rooms.get(currentRoom);
                        if (chatRoom) {
                            broadcastToRoom(currentRoom, {
                                type: 'newChatMessage',
                                playerId: playerId,
                                playerName: chatRoom.players.find(p => p.id === playerId).name,
                                message: data.message,
                                time: new Date().toLocaleTimeString()
                            });
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('消息处理错误:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: '服务器处理消息失败'
            }));
        }
    });

    // 处理断开连接
    ws.on('close', () => {
        console.log('玩家断开连接:', playerId);
        if (currentRoom && playerId) {
            const room = rooms.get(currentRoom);
            if (room) {
                // 移除玩家
                room.players = room.players.filter(p => p.id !== playerId);
                
                // 房主断开，重新选举房主
                if (room.host === playerId && room.players.length > 0) {
                    room.host = room.players[0].id;
                    room.players[0].isHost = true;
                    
                    broadcastToRoom(room.id, {
                        type: 'hostElected',
                        hostId: room.host,
                        hostName: room.players[0].name,
                        players: room.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                    });
                } else if (room.players.length > 0) {
                    // 广播玩家离开
                    broadcastToRoom(room.id, {
                        type: 'playerLeft',
                        playerId: playerId,
                        players: room.players.map(p => ({id: p.id, name: p.name, isHost: p.isHost}))
                    });
                } else {
                    // 房间为空，删除房间
                    rooms.delete(currentRoom);
                }
            }
        }
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

// 向房间内所有玩家广播消息
function broadcastToRoom(roomId, message) {
    const room = rooms.get(roomId);
    if (room) {
        const messageStr = JSON.stringify(message);
        room.players.forEach(player => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(messageStr);
            }
        });
    }
}

// 根据角色配置生成角色列表
function generateRoleList(roleConfig, playerCount) {
    const roleList = [];

    // 添加狼人阵营
    for (let i = 0; i < roleConfig.normalWolf; i++) roleList.push('普通狼人');
    for (let i = 0; i < roleConfig.whiteWolf; i++) roleList.push('白狼王');

    // 添加好人阵营-神职
    for (let i = 0; i < roleConfig.seer; i++) roleList.push('预言家');
    for (let i = 0; i < roleConfig.witch; i++) roleList.push('女巫');
    for (let i = 0; i < roleConfig.hunter; i++) roleList.push('猎人');
    for (let i = 0; i < roleConfig.guard; i++) roleList.push('守卫');

    // 添加好人阵营-平民
    for (let i = 0; i < roleConfig.civilian; i++) roleList.push('普通平民');

    // 添加中立阵营
    for (let i = 0; i < roleConfig.idiot; i++) roleList.push('白痴');

    // 随机打乱角色列表（确保公平）
    roleList.sort(() => Math.random() - 0.5);

    // 确保角色列表长度等于玩家数（防止配置错误）
    return roleList.slice(0, playerCount);
}

// 启动服务器（Render会自动分配PORT，必须用process.env.PORT）
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`访问地址: http://localhost:${PORT}`);
});