/**
 * 狼人杀游戏核心逻辑
 * 包含角色配置、游戏阶段管理、技能处理、胜负判定等核心功能
 */

class WerewolfGameLogic {
    constructor() {
        // 游戏核心状态
        this.gameState = {
            roomId: '',
            players: [], // 玩家列表 {id, name, role, faction, isAlive, isRevealed, skills, playerNumber, isWildChildTransformed, wildChildMentor}
            gamePhase: 'waiting', // waiting/night/day/voting/ended
            day: 1, // 当前天数
            nightActions: {}, // 夜晚行动记录
            voteRecords: {}, // 投票记录
            skillUsageRecords: {}, // 技能使用记录
            cupidPairs: [], // 丘比特情侣
            winner: '', // 获胜阵营
            config: {
                speakTime: 120, // 发言时间(秒)
                firstNightKill: true, // 首夜狼人是否可以杀人
                canRevive: false, // 是否允许复活（自定义规则）
                wildChildTransform: true // 野孩子是否会变身
            }
        };

        // 角色配置清单（完整版）
        this.roleConfig = {
            // 狼人阵营
            '普通狼人': {
                faction: 'wolf',
                skills: ['杀人'],
                winCondition: '消灭所有神民或平民',
                canActAtNight: true
            },
            '白狼王': {
                faction: 'wolf',
                skills: ['杀人', '自爆带走一名玩家'],
                winCondition: '消灭所有神民或平民',
                canActAtNight: true
            },
            '普通狼王': {
                faction: 'wolf',
                skills: ['杀人', '被投票出局可带走一名玩家'],
                winCondition: '消灭所有神民或平民',
                canActAtNight: true
            },
            '血月使徒': {
                faction: 'wolf',
                skills: ['杀人', '自爆后当晚无神职行动'],
                winCondition: '消灭所有神民或平民',
                canActAtNight: true
            },

            // 神民阵营
            '预言家': {
                faction: 'god',
                skills: ['查验一名玩家身份'],
                winCondition: '消灭所有狼人',
                canActAtNight: true
            },
            '女巫': {
                faction: 'god',
                skills: ['解药（救一人）', '毒药（毒一人）'],
                winCondition: '消灭所有狼人',
                canActAtNight: true,
                hasAntidote: true,
                hasPoison: true
            },
            '猎人': {
                faction: 'god',
                skills: ['被狼人杀/投票出局可开枪带走一人'],
                winCondition: '消灭所有狼人',
                canActAtNight: false,
                canShoot: true
            },
            '守卫': {
                faction: 'god',
                skills: ['守护一名玩家不被狼人杀死（不能连续守同一人）'],
                winCondition: '消灭所有狼人',
                canActAtNight: true,
                guardedPlayer: null,
                lastGuarded: null
            },
            '禁言长老': {
                faction: 'god',
                skills: ['禁言一名玩家白天不能发言'],
                winCondition: '消灭所有狼人',
                canActAtNight: true,
                silencedPlayer: null
            },
            '骑士': {
                faction: 'god',
                skills: ['白天可决斗一名玩家，若为狼人则对方出局，否则自己出局'],
                winCondition: '消灭所有狼人',
                canActAtNight: false,
                hasDueled: false
            },

            // 平民阵营
            '普通平民': {
                faction: 'civilian',
                skills: [],
                winCondition: '消灭所有狼人',
                canActAtNight: false
            },
            '老流氓': {
                faction: 'civilian',
                skills: ['不会被禁言，被女巫毒/猎人开枪不会出局'],
                winCondition: '消灭所有狼人',
                canActAtNight: false,
                isImmune: true
            },

            // 中立阵营
            '炸弹人': {
                faction: 'neutral',
                skills: ['被投票出局会炸死所有投自己的玩家'],
                winCondition: '炸死所有狼人或神民',
                canActAtNight: false
            },
            '白痴': {
                faction: 'neutral',
                skills: ['被投票出局不会死，失去投票权'],
                winCondition: '活到最后（狼人/好人阵营获胜时自己也获胜）',
                canActAtNight: false,
                isDead: false
            },
            '丘比特': {
                faction: 'neutral',
                skills: ['首夜指定两人成为情侣，情侣同生共死'],
                winCondition: '情侣存活到最后',
                canActAtNight: true,
                hasPaired: false
            },
            '野孩子': {
                faction: 'neutral',
                skills: ['首夜认一名玩家为导师，导师死亡则变狼人'],
                winCondition: '导师存活 或 变狼后狼人获胜',
                canActAtNight: true,
                hasChosenMentor: false
            }
        };
    }

    /**
     * 初始化游戏
     * @param {string} roomId 房间ID
     * @param {Array} players 玩家列表 [{id, name}]
     * @param {Object} roleConfig 角色配置 {normalWolf:2, seer:1,...}
     * @param {Object} gameConfig 游戏配置
     */
    initGame(roomId, players, roleConfig, gameConfig) {
        this.gameState.roomId = roomId;
        this.gameState.config = { ...this.gameState.config, ...gameConfig };
        
        // 生成角色列表并分配给玩家
        const roleList = this.generateRoleList(roleConfig, players.length);
        this.gameState.players = this.assignRoles(players, roleList);
        
        // 初始化游戏阶段
        this.gameState.gamePhase = 'night';
        this.gameState.nightActions = {};
        this.gameState.voteRecords = {};
        
        return this.gameState;
    }

    /**
     * 生成角色列表（完善版）
     * @param {Object} roleConfig 角色配置
     * @param {number} playerCount 玩家数量
     * @returns {Array} 角色名称列表
     */
    generateRoleList(roleConfig, playerCount) {
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

    /**
     * 分配角色给玩家
     * @param {Array} players 玩家列表
     * @param {Array} roleList 角色列表
     * @returns {Array} 带角色信息的玩家列表
     */
    assignRoles(players, roleList) {
        // 随机打乱角色顺序（双重随机确保公平）
        const shuffledRoles = this.shuffleArray([...roleList]);
        
        return players.map((player, index) => ({
            ...player,
            role: shuffledRoles[index],
            faction: this.roleConfig[shuffledRoles[index]].faction,
            skills: [...this.roleConfig[shuffledRoles[index]].skills],
            isAlive: true,
            isRevealed: false,
            playerNumber: index + 1,
            // 角色专属状态
            isWildChildTransformed: false,
            wildChildMentor: null,
            // 女巫专属
            hasAntidote: shuffledRoles[index] === '女巫' ? true : false,
            hasPoison: shuffledRoles[index] === '女巫' ? true : false,
            // 猎人专属
            canShoot: shuffledRoles[index] === '猎人' ? true : false,
            // 守卫专属
            guardedPlayer: null,
            lastGuarded: null,
            // 禁言长老专属
            silencedPlayer: null,
            // 骑士专属
            hasDueled: false,
            // 丘比特专属
            hasPaired: false
        }));
    }

    /**
     * 洗牌函数（Fisher-Yates 算法）
     * @param {Array} array 待洗牌数组
     * @returns {Array} 洗牌后的数组
     */
    shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }

    /**
     * 处理夜晚阶段
     * @param {Object} nightActions 夜晚行动记录
     * @returns {Object} 夜晚处理结果
     */
    processNightPhase(nightActions) {
        this.gameState.nightActions = nightActions;
        const result = {
            deadPlayers: [],
            skillMessages: [],
            phaseChange: 'day'
        };

        // 1. 处理丘比特配对（仅首夜）
        if (this.gameState.day === 1) {
            const cupid = this.gameState.players.find(p => p.role === '丘比特' && p.isAlive && !p.hasPaired);
            if (cupid && nightActions.cupid) {
                const pairIds = nightActions.cupid.pairIds;
                if (pairIds && pairIds.length === 2) {
                    const pair1 = this.gameState.players.find(p => p.id === pairIds[0]);
                    const pair2 = this.gameState.players.find(p => p.id === pairIds[1]);
                    if (pair1 && pair2) {
                        this.gameState.cupidPairs = pairIds;
                        cupid.hasPaired = true;
                        result.skillMessages.push(`丘比特将 ${pair1.name} 和 ${pair2.name} 设为情侣`);
                    }
                }
            }
        }

        // 2. 处理野孩子认导师（仅首夜）
        if (this.gameState.day === 1) {
            const wildChild = this.gameState.players.find(p => p.role === '野孩子' && p.isAlive && !p.hasChosenMentor);
            if (wildChild && nightActions.wildChild) {
                const mentorId = nightActions.wildChild.mentorId;
                const mentor = this.gameState.players.find(p => p.id === mentorId);
                if (mentor) {
                    wildChild.wildChildMentor = mentorId;
                    wildChild.hasChosenMentor = true;
                    result.skillMessages.push(`野孩子认 ${mentor.name} 为导师`);
                }
            }
        }

        // 3. 处理守卫守护
        const guard = this.gameState.players.find(p => p.role === '守卫' && p.isAlive);
        if (guard && nightActions.guard) {
            const guardedId = nightActions.guard.guardedPlayerId;
            // 不能连续守护同一人
            if (guardedId !== guard.lastGuarded) {
                guard.guardedPlayer = guardedId;
                guard.lastGuarded = guardedId;
                result.skillMessages.push(`守卫守护了 ${this.getPlayerNameById(guardedId)}`);
            }
        }

        // 4. 处理狼人杀人（首夜可配置是否杀人）
        if (this.gameState.config.firstNightKill || this.gameState.day > 1) {
            const wolfKillTarget = nightActions.wolf?.killTargetId;
            if (wolfKillTarget) {
                const targetPlayer = this.gameState.players.find(p => p.id === wolfKillTarget && p.isAlive);
                if (targetPlayer) {
                    // 检查是否被守卫守护
                    const isGuarded = guard?.guardedPlayer === wolfKillTarget;
                    // 检查女巫是否救
                    const witch = this.gameState.players.find(p => p.role === '女巫' && p.isAlive);
                    const isSaved = witch && witch.hasAntidote && nightActions.witch?.savedPlayerId === wolfKillTarget;

                    if (isSaved) {
                        witch.hasAntidote = false;
                        result.skillMessages.push(`女巫使用解药救下了 ${targetPlayer.name}`);
                    } else if (!isGuarded) {
                        // 标记死亡
                        targetPlayer.isAlive = false;
                        result.deadPlayers.push(targetPlayer.id);
                        result.skillMessages.push(`狼人杀死了 ${targetPlayer.name}`);

                        // 处理情侣死亡（同生共死）
                        this.handleCupidPairDeath(targetPlayer.id, result);
                    } else {
                        result.skillMessages.push(`守卫成功守护 ${targetPlayer.name}，狼人杀人失败`);
                    }
                }
            }
        }

        // 5. 处理女巫毒人
        const witch = this.gameState.players.find(p => p.role === '女巫' && p.isAlive);
        if (witch && witch.hasPoison && nightActions.witch?.poisonedPlayerId) {
            const poisonTargetId = nightActions.witch.poisonedPlayerId;
            const poisonTarget = this.gameState.players.find(p => p.id === poisonTargetId && p.isAlive);
            
            if (poisonTarget) {
                // 老流氓免疫毒药
                if (poisonTarget.role === '老流氓') {
                    result.skillMessages.push(`女巫试图毒杀 ${poisonTarget.name}，但老流氓免疫毒药`);
                } else {
                    poisonTarget.isAlive = false;
                    witch.hasPoison = false;
                    result.deadPlayers.push(poisonTargetId);
                    result.skillMessages.push(`女巫使用毒药毒杀了 ${poisonTarget.name}`);
                    
                    // 处理情侣死亡
                    this.handleCupidPairDeath(poisonTargetId, result);
                }
            }
        }

        // 6. 处理预言家查验
        const seer = this.gameState.players.find(p => p.role === '预言家' && p.isAlive);
        if (seer && nightActions.seer) {
            const checkedPlayerId = nightActions.seer.checkedPlayerId;
            const checkedPlayer = this.gameState.players.find(p => p.id === checkedPlayerId);
            if (checkedPlayer) {
                const isWolf = checkedPlayer.faction === 'wolf';
                result.skillMessages.push(`预言家查验 ${checkedPlayer.name}，结果：${isWolf ? '狼人' : '好人'}`);
                // 仅返回给预言家的信息
                result.seerResult = {
                    playerId: checkedPlayerId,
                    isWolf: isWolf
                };
            }
        }

        // 7. 处理禁言长老禁言
        const silencer = this.gameState.players.find(p => p.role === '禁言长老' && p.isAlive);
        if (silencer && nightActions.silencer) {
            const silencedId = nightActions.silencer.silencedPlayerId;
            const silencedPlayer = this.gameState.players.find(p => p.id === silencedId && p.isAlive);
            if (silencedPlayer) {
                // 老流氓免疫禁言
                if (silencedPlayer.role === '老流氓') {
                    result.skillMessages.push(`禁言长老试图禁言 ${silencedPlayer.name}，但老流氓免疫禁言`);
                } else {
                    silencer.silencedPlayer = silencedId;
                    result.skillMessages.push(`禁言长老禁言了 ${silencedPlayer.name}，其白天无法发言`);
                }
            }
        }

        // 8. 处理血月使徒自爆（当晚无神职行动）
        const bloodMoonApostle = this.gameState.players.find(p => p.role === '血月使徒' && p.isAlive);
        if (bloodMoonApostle && nightActions.bloodMoonApostle?.isSelfExplode) {
            bloodMoonApostle.isAlive = false;
            result.deadPlayers.push(bloodMoonApostle.id);
            result.skillMessages.push(`血月使徒自爆，当晚所有神职行动无效`);
            result.phaseChange = 'day'; // 自爆直接到白天
            // 清空其他神职行动
            result.skillMessages = [`血月使徒自爆，当晚所有神职行动无效`];
        }

        // 9. 处理白狼王自爆
        const whiteWolf = this.gameState.players.find(p => p.role === '白狼王' && p.isAlive);
        if (whiteWolf && nightActions.whiteWolf?.isSelfExplode) {
            whiteWolf.isAlive = false;
            result.deadPlayers.push(whiteWolf.id);
            
            // 带走一名玩家
            const takePlayerId = nightActions.whiteWolf.takePlayerId;
            const takePlayer = this.gameState.players.find(p => p.id === takePlayerId && p.isAlive);
            if (takePlayer) {
                takePlayer.isAlive = false;
                result.deadPlayers.push(takePlayerId);
                result.skillMessages.push(`白狼王自爆，带走了 ${takePlayer.name}`);
                
                // 处理情侣死亡
                this.handleCupidPairDeath(takePlayerId, result);
            }
        }

        // 10. 检查野孩子是否变身
        this.checkWildChildTransform(result);

        // 更新游戏阶段
        this.gameState.gamePhase = result.phaseChange;

        return result;
    }

    /**
     * 处理白天投票阶段
     * @param {Object} voteRecords 投票记录 {投票人ID: 被投票人ID}
     * @returns {Object} 投票处理结果
     */
    processVotePhase(voteRecords) {
        this.gameState.voteRecords = voteRecords;
        const result = {
            votedPlayerId: null,
            deadPlayers: [],
            skillMessages: [],
            phaseChange: 'night'
        };

        // 统计投票
        const voteCount = {};
        Object.values(voteRecords).forEach(targetId => {
            if (targetId) {
                voteCount[targetId] = (voteCount[targetId] || 0) + 1;
            }
        });

        // 找到得票最多的玩家
        let maxVotes = 0;
        let votedPlayerId = null;
        Object.entries(voteCount).forEach(([playerId, count]) => {
            if (count > maxVotes) {
                maxVotes = count;
                votedPlayerId = playerId;
            }
        });

        if (!votedPlayerId) {
            result.skillMessages.push('本轮投票无人得票最多，无人被放逐');
            this.gameState.gamePhase = 'night';
            return result;
        }

        result.votedPlayerId = votedPlayerId;
        const votedPlayer = this.gameState.players.find(p => p.id === votedPlayerId);

        if (!votedPlayer || !votedPlayer.isAlive) {
            result.skillMessages.push('被投票玩家已死亡，投票无效');
            return result;
        }

        // 处理不同角色被投票的特殊逻辑
        switch (votedPlayer.role) {
            case '白痴':
                // 白痴被投票不出局，仅失去投票权
                votedPlayer.isDead = true; // 标记为失去投票权
                result.skillMessages.push(`${votedPlayer.name}（白痴）被投票，但不会出局，仅失去投票权`);
                break;

            case '炸弹人':
                // 炸弹人被投票出局，炸死所有投他的玩家
                votedPlayer.isAlive = false;
                result.deadPlayers.push(votedPlayerId);
                result.skillMessages.push(`${votedPlayer.name}（炸弹人）被投票出局，触发炸弹！`);
                
                // 找出所有投炸弹人的玩家
                const bomberVoters = Object.entries(voteRecords)
                    .filter(([voterId, targetId]) => targetId === votedPlayerId)
                    .map(([voterId]) => voterId);
                
                bomberVoters.forEach(voterId => {
                    const voter = this.gameState.players.find(p => p.id === voterId && p.isAlive);
                    if (voter) {
                        voter.isAlive = false;
                        result.deadPlayers.push(voterId);
                        result.skillMessages.push(`炸弹人炸死了投票者 ${voter.name}`);
                        
                        // 处理情侣死亡
                        this.handleCupidPairDeath(voterId, result);
                    }
                });
                break;

            case '普通狼王':
                // 狼王被投票出局，可带走一人
                votedPlayer.isAlive = false;
                result.deadPlayers.push(votedPlayerId);
                result.skillMessages.push(`${votedPlayer.name}（狼王）被投票出局`);
                
                // 检查狼王是否选择带走玩家
                const kingTakePlayerId = this.gameState.voteRecords[votedPlayerId];
                if (kingTakePlayerId) {
                    const takePlayer = this.gameState.players.find(p => p.id === kingTakePlayerId && p.isAlive);
                    if (takePlayer) {
                        takePlayer.isAlive = false;
                        result.deadPlayers.push(kingTakePlayerId);
                        result.skillMessages.push(`狼王临死前带走了 ${takePlayer.name}`);
                        
                        // 处理情侣死亡
                        this.handleCupidPairDeath(kingTakePlayerId, result);
                    }
                }
                break;

            default:
                // 普通角色被投票出局
                votedPlayer.isAlive = false;
                result.deadPlayers.push(votedPlayerId);
                result.skillMessages.push(`${votedPlayer.name} 被投票出局`);
                
                // 处理猎人被投票出局开枪
                if (votedPlayer.role === '猎人' && votedPlayer.canShoot) {
                    const hunterShootId = this.gameState.voteRecords[votedPlayerId];
                    if (hunterShootId) {
                        const shootPlayer = this.gameState.players.find(p => p.id === hunterShootId && p.isAlive);
                        if (shootPlayer) {
                            // 老流氓免疫猎人开枪
                            if (shootPlayer.role === '老流氓') {
                                result.skillMessages.push(`猎人 ${votedPlayer.name} 试图开枪打死 ${shootPlayer.name}，但老流氓免疫`);
                            } else {
                                shootPlayer.isAlive = false;
                                result.deadPlayers.push(hunterShootId);
                                result.skillMessages.push(`猎人 ${votedPlayer.name} 被投票出局，开枪打死了 ${shootPlayer.name}`);
                                
                                // 处理情侣死亡
                                this.handleCupidPairDeath(shootPlayerId, result);
                            }
                        }
                    }
                    votedPlayer.canShoot = false;
                }
                
                // 处理情侣死亡
                this.handleCupidPairDeath(votedPlayerId, result);
                break;
        }

        // 检查游戏是否结束
        const winner = this.checkWinner();
        if (winner) {
            result.winner = winner;
            result.phaseChange = 'ended';
            this.gameState.winner = winner;
            this.gameState.gamePhase = 'ended';
        } else {
            // 进入下一夜
            this.gameState.day += 1;
            this.gameState.gamePhase = 'night';
        }

        return result;
    }

    /**
     * 处理骑士决斗
     * @param {string} knightId 骑士ID
     * @param {string} targetId 决斗目标ID
     * @returns {Object} 决斗结果
     */
    processKnightDuel(knightId, targetId) {
        const result = {
            messages: [],
            deadPlayers: []
        };

        const knight = this.gameState.players.find(p => p.id === knightId && p.isAlive && p.role === '骑士');
        const target = this.gameState.players.find(p => p.id === targetId && p.isAlive);

        if (!knight || knight.hasDueled) {
            result.messages.push('骑士已决斗过，无法再次决斗');
            return result;
        }

        if (!target) {
            result.messages.push('决斗目标不存在或已死亡');
            return result;
        }

        knight.hasDueled = true;
        const isWolf = target.faction === 'wolf';

        if (isWolf) {
            // 目标是狼人，目标出局
            target.isAlive = false;
            result.deadPlayers.push(targetId);
            result.messages.push(`骑士 ${knight.name} 决斗 ${target.name}，对方是狼人！${target.name} 出局`);
            
            // 处理情侣死亡
            this.handleCupidPairDeath(targetId, result);
        } else {
            // 目标是好人，骑士出局
            knight.isAlive = false;
            result.deadPlayers.push(knightId);
            result.messages.push(`骑士 ${knight.name} 决斗 ${target.name}，对方是好人！骑士出局`);
            
            // 处理情侣死亡
            this.handleCupidPairDeath(knightId, result);
        }

        // 检查游戏是否结束
        const winner = this.checkWinner();
        if (winner) {
            result.winner = winner;
        }

        return result;
    }

    /**
     * 检查野孩子是否变身
     * @param {Object} result 处理结果对象
     */
    checkWildChildTransform(result) {
        if (!this.gameState.config.wildChildTransform) return;

        const wildChild = this.gameState.players.find(p => 
            p.role === '野孩子' && p.isAlive && !p.isWildChildTransformed && p.wildChildMentor
        );

        if (wildChild) {
            const mentor = this.gameState.players.find(p => p.id === wildChild.wildChildMentor);
            if (!mentor || !mentor.isAlive) {
                // 导师死亡，野孩子变狼人
                wildChild.isWildChildTransformed = true;
                wildChild.faction = 'wolf';
                result.skillMessages.push(`野孩子 ${wildChild.name} 的导师已死亡，变身成为狼人！`);
            }
        }
    }

    /**
     * 处理情侣死亡（同生共死）
     * @param {string} deadPlayerId 死亡玩家ID
     * @param {Object} result 处理结果对象
     */
    handleCupidPairDeath(deadPlayerId, result) {
        if (this.gameState.cupidPairs.length !== 2) return;

        const [pair1Id, pair2Id] = this.gameState.cupidPairs;
        if (deadPlayerId === pair1Id) {
            const pair2 = this.gameState.players.find(p => p.id === pair2Id && p.isAlive);
            if (pair2) {
                pair2.isAlive = false;
                result.deadPlayers.push(pair2Id);
                result.skillMessages.push(`${pair2.name} 作为情侣，随 ${this.getPlayerNameById(deadPlayerId)} 一同死亡`);
            }
        } else if (deadPlayerId === pair2Id) {
            const pair1 = this.gameState.players.find(p => p.id === pair1Id && p.isAlive);
            if (pair1) {
                pair1.isAlive = false;
                result.deadPlayers.push(pair1Id);
                result.skillMessages.push(`${pair1.name} 作为情侣，随 ${this.getPlayerNameById(deadPlayerId)} 一同死亡`);
            }
        }
    }

    /**
     * 检查游戏胜负
     * @returns {string} 获胜阵营（wolf/god/civilian/neutral/''）
     */
    checkWinner() {
        // 存活玩家统计
        const alivePlayers = this.gameState.players.filter(p => p.isAlive);
        const wolfCount = alivePlayers.filter(p => p.faction === 'wolf' || (p.role === '野孩子' && p.isWildChildTransformed)).length;
        const godCount = alivePlayers.filter(p => p.faction === 'god').length;
        const civilianCount = alivePlayers.filter(p => p.faction === 'civilian').length;
        const totalGood = godCount + civilianCount;

        // 1. 狼人获胜条件：神民和平民总数 ≤ 狼人数量
        if (totalGood <= wolfCount && wolfCount > 0) {
            return 'wolf';
        }

        // 2. 好人获胜条件：所有狼人死亡
        if (wolfCount === 0) {
            return 'god'; // 神民+平民统一归为好人阵营
        }

        // 3. 丘比特获胜条件：情侣存活且成为最后两人
        if (this.gameState.cupidPairs.length === 2) {
            const [p1, p2] = this.gameState.cupidPairs;
            const p1Alive = alivePlayers.some(p => p.id === p1);
            const p2Alive = alivePlayers.some(p => p.id === p2);
            if (p1Alive && p2Alive && alivePlayers.length === 2) {
                return 'neutral'; // 丘比特/情侣获胜
            }
        }

        // 4. 白痴获胜条件：活到最后（仅剩白痴和另一阵营）
        const idiot = alivePlayers.find(p => p.role === '白痴' && p.isAlive);
        if (idiot && alivePlayers.length === 2) {
            return 'neutral';
        }

        // 5. 炸弹人获胜条件：炸死所有狼人或神民
        const bomber = alivePlayers.find(p => p.role === '炸弹人' && p.isAlive);
        if (bomber) {
            const aliveWolf = alivePlayers.some(p => p.faction === 'wolf');
            const aliveGod = alivePlayers.some(p => p.faction === 'god');
            
            if (!aliveWolf || !aliveGod) {
                return 'neutral';
            }
        }

        // 游戏继续
        return '';
    }

    /**
     * 根据玩家ID获取玩家名称
     * @param {string} playerId 玩家ID
     * @returns {string} 玩家名称
     */
    getPlayerNameById(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        return player ? player.name : '未知玩家';
    }

    /**
     * 重置游戏状态
     */
    resetGame() {
        this.gameState = {
            roomId: '',
            players: [],
            gamePhase: 'waiting',
            day: 1,
            nightActions: {},
            voteRecords: {},
            skillUsageRecords: {},
            cupidPairs: [],
            winner: '',
            config: {
                speakTime: 120,
                firstNightKill: true,
                canRevive: false,
                wildChildTransform: true
            }
        };
    }
}

// 导出供服务器使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WerewolfGameLogic;
}
