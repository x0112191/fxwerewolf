// 狼人杀游戏逻辑系统 - 完整版，包含所有新角色
class WerewolfGame {
    constructor() {
        // 角色配置 - 完整角色清单
        this.roleConfig = {
            // 狼人阵营
            werewolves: [
                { name: '普通狼人', count: 0, faction: 'werewolf', skills: ['night_kill'] },
                { name: '白狼王', count: 0, faction: 'werewolf', skills: ['night_kill', 'self_explode'] },
                { name: '普通狼王', count: 0, faction: 'werewolf', skills: ['night_kill', 'revenge_vote'] },
                { name: '血月使徒', count: 0, faction: 'werewolf', skills: ['night_kill', 'curse'] }
            ],
            // 神民阵营
            gods: [
                { name: '预言家', count: 0, faction: 'god', skills: ['divine'] },
                { name: '女巫', count: 0, faction: 'god', skills: ['antidote', 'poison'] },
                { name: '猎人', count: 0, faction: 'god', skills: ['hunt'] },
                { name: '守卫', count: 0, faction: 'god', skills: ['guard'] },
                { name: '禁言长老', count: 0, faction: 'god', skills: ['silence'] },
                { name: '骑士', count: 0, faction: 'god', skills: ['challenge'] }
            ],
            // 平民阵营
            civilians: [
                { name: '普通平民', count: 0, faction: 'civilian', skills: [] },
                { name: '老流氓', count: 0, faction: 'civilian', skills: ['delayed_death'] }
            ],
            // 中立阵营
            neutrals: [
                { name: '炸弹人', count: 0, faction: 'neutral', skills: ['explode_on_vote'] },
                { name: '白痴', count: 0, faction: 'neutral', skills: ['idiot_win'] },
                { name: '丘比特', count: 0, faction: 'neutral', skills: ['connect_lovers'] },
                { name: '野孩子', count: 0, faction: 'neutral', skills: ['choose_mentor', 'transform_werewolf'] }
            ]
        };

        // 游戏状态
        this.gameState = {
            phase: 'setup', // setup, night, day, voting, game_over
            day: 1,
            round: 1,
            players: [],
            alivePlayers: [],
            deadPlayers: [],
            currentActions: {}, // 当前阶段的玩家行动
            nightActions: {}, // 夜晚行动记录
            dayActions: {}, // 白天行动记录
            lovers: [], // 被丘比特连接的情侣
            silencedPlayers: [], // 被禁言的玩家
            guardedPlayers: [], // 被守护的玩家
            cursedPlayers: [], // 被血月使徒诅咒的玩家
            votes: {}, // 投票记录
            gameLog: [], // 游戏日志
            // 新角色特殊状态
            specialState: {
                whiteWerewolf: {
                    selfExploded: false, // 白狼王是否已自爆
                    explosionTarget: null // 自爆带走的目标
                },
                knight: {
                    challenged: false, // 骑士是否已挑战
                    challengeTarget: null, // 挑战目标
                    challengeResult: null // 挑战结果
                },
                werewolfKing: {
                    revengeUsed: false, // 狼王是否已复仇
                    revengeTarget: null // 复仇带走的目标
                },
                hunter: {
                    huntUsed: false, // 猎人是否已开枪
                    huntTarget: null, // 开枪带走的目标
                    canHunt: false // 是否可以开枪
                },
                wildChild: {
                    mentor: null, // 野孩子的榜样
                    mentorAlive: true, // 榜样是否存活
                    transformed: false // 是否已转化为狼人
                },
                bloodMoon: {
                    cursedPlayers: [], // 被诅咒的玩家列表
                    firstNight: true // 是否为首夜
                }
            }
        };

        // 技能使用状态
        this.skillState = {
            witch: {
                antidoteUsed: false,
                poisonUsed: false
            },
            guard: {
                lastGuarded: null // 上次守护的玩家
            },
            silence: {
                lastSilenced: null // 上次禁言的玩家
            }
        };

        // 房主配置的角色数量
        this.hostConfig = {
            werewolves: {
                '普通狼人': 2,
                '白狼王': 1,
                '普通狼王': 0,
                '血月使徒': 0
            },
            gods: {
                '预言家': 1,
                '女巫': 1,
                '猎人': 1,
                '守卫': 1,
                '禁言长老': 1,
                '骑士': 0
            },
            civilians: {
                '普通平民': 3,
                '老流氓': 0
            },
            neutrals: {
                '炸弹人': 0,
                '白痴': 0,
                '丘比特': 0,
                '野孩子': 0
            }
        };
    }

    // 设置房主配置
    setHostConfig(config) {
        this.hostConfig = { ...this.hostConfig, ...config };
    }

    // 获取房主配置的角色列表
    getHostRoleList() {
        const roleList = [];
        
        // 狼人阵营
        Object.entries(this.hostConfig.werewolves).forEach(([role, count]) => {
            for (let i = 0; i < count; i++) {
                const roleConfig = this.roleConfig.werewolves.find(r => r.name === role);
                if (roleConfig) {
                    roleList.push({ ...roleConfig });
                }
            }
        });

        // 神民阵营
        Object.entries(this.hostConfig.gods).forEach(([role, count]) => {
            for (let i = 0; i < count; i++) {
                const roleConfig = this.roleConfig.gods.find(r => r.name === role);
                if (roleConfig) {
                    roleList.push({ ...roleConfig });
                }
            }
        });

        // 平民阵营
        Object.entries(this.hostConfig.civilians).forEach(([role, count]) => {
            for (let i = 0; i < count; i++) {
                const roleConfig = this.roleConfig.civilians.find(r => r.name === role);
                if (roleConfig) {
                    roleList.push({ ...roleConfig });
                }
            }
        });

        // 中立阵营
        Object.entries(this.hostConfig.neutrals).forEach(([role, count]) => {
            for (let i = 0; i < count; i++) {
                const roleConfig = this.roleConfig.neutrals.find(r => r.name === role);
                if (roleConfig) {
                    roleList.push({ ...roleConfig });
                }
            }
        });

        return roleList;
    }

    // 初始化游戏
    initializeGame(players) {
        if (players.length < 8) {
            throw new Error('游戏至少需要8名玩家');
        }

        const roleList = this.getHostRoleList();
        if (roleList.length !== players.length) {
            throw new Error(`角色数量(${roleList.length})与玩家数量(${players.length})不匹配`);
        }

        this.gameState.players = this.assignRoles(players, roleList);
        this.gameState.alivePlayers = [...this.gameState.players];
        this.gameState.phase = 'night';
        this.gameState.day = 1;
        this.gameState.round = 1;

        this.addGameLog('游戏开始', '系统');
        this.addGameLog(`第1天夜晚降临，共有${players.length}名玩家参与游戏`, '系统');

        return this.gameState;
    }

    // 分配角色
    assignRoles(players, roleList) {
        // 随机分配角色给玩家
        const shuffledRoles = this.shuffleArray([...roleList]);
        return players.map((player, index) ({
            ...player,
            role: shuffledRoles[index].name,
            faction: shuffledRoles[index].faction,
            skills: [...shuffledRoles[index].skills],
            isAlive: true,
            isRevealed: false,
            playerNumber: index + 1,
            // 野孩子特殊状态
            isWildChildTransformed: false,
            wildChildMentor: null
        }));
    }

    // 夜晚阶段处理
    processNightPhase(actions) {
        this.gameState.nightActions = { ...actions };
        this.addGameLog(`第${this.gameState.day}天夜晚行动开始`, '系统');

        let nightResults = {
            deaths: [],
            saves: [],
            divineResults: {},
            guardSuccess: false,
            silenceSuccess: false,
            curseSuccess: false,
            wildChildMentorChosen: false
        };

        // 处理野孩子选择榜样（仅第一夜）
        if (this.gameState.day === 1 && actions.wildChildChooseMentor) {
            const mentor = actions.wildChildChooseMentor.target;
            const mentorPlayer = this.gameState.alivePlayers.find(p => p.key === mentor);
            
            if (mentorPlayer) {
                this.gameState.specialState.wildChild.mentor = mentor;
                this.gameState.specialState.wildChild.mentorAlive = true;
                
                this.addGameLog(`野孩子选择${mentorPlayer.name}作为榜样`, '系统');
                nightResults.wildChildMentorChosen = true;
                
                // 通知野孩子
                const wildChild = this.gameState.alivePlayers.find(p => p.role === '野孩子');
                if (wildChild) {
                    this.addGameLog(`你的榜样是${mentorPlayer.name}，榜样存活期间你为中立阵营`, wildChild.name);
                }
            }
        }

        // 处理血月使徒诅咒（首夜不可参与狼刀）
        if (actions.bloodMoonCurse) {
            const curser = actions.bloodMoonCurse.player;
            const target = actions.bloodMoonCurse.target;
            const targetPlayer = this.gameState.alivePlayers.find(p => p.key === target);
            
            if (targetPlayer) {
                // 检查是否为首夜
                if (this.gameState.specialState.bloodMoon.firstNight) {
                    this.addGameLog(`血月使徒${curser}首夜旁观狼刀，诅咒了${targetPlayer.name}`, '系统');
                } else {
                    this.addGameLog(`血月使徒诅咒了${targetPlayer.name}`, '系统');
                }
                
                this.gameState.cursedPlayers = [target];
                this.gameState.specialState.bloodMoon.cursedPlayers.push(target);
                nightResults.curseSuccess = true;
                
                // 根据目标身份决定诅咒效果
                const isGodRole = this.isGodRole(targetPlayer.role);
                if (isGodRole) {
                    this.addGameLog(`${targetPlayer.name}（神职）被诅咒，当晚技能失效且被禁言`, '系统');
                } else {
                    this.addGameLog(`${targetPlayer.name}被诅咒，当晚被禁言`, '系统');
                }
            }
        }

        // 处理狼人击杀（血月使徒首夜不可参与）
        if (actions.werewolfKill) {
            const target = actions.werewolfKill.target;
            const targetPlayer = this.gameState.alivePlayers.find(p => p.key === target);
            
            if (targetPlayer) {
                // 检查是否有血月使徒参与
                const werewolfPlayers = actions.werewolfKill.werewolves || [];
                const bloodMoonPlayer = this.gameState.alivePlayers.find(p => p.role === '血月使徒' && p.isAlive);
                
                if (this.gameState.specialState.bloodMoon.firstNight && bloodMoonPlayer && werewolfPlayers.includes(bloodMoonPlayer.key)) {
                    this.addGameLog(`血月使徒${bloodMoonPlayer.name}首夜不可参与狼刀，仅旁观`, '系统');
                    // 从狼人列表中移除血月使徒
                    actions.werewolfKill.werewolves = werewolfPlayers.filter(w => w !== bloodMoonPlayer.key);
                }
                
                this.addGameLog(`狼人选择了${targetPlayer.name}作为击杀目标`, '系统');
                
                // 检查是否有守卫
                const isGuarded = this.gameState.guardedPlayers.includes(target);
                if (isGuards) {
                    this.addGameLog(`${targetPlayer.name}被守卫保护，狼人击杀失败`, '系统');
                    nightResults.guardSuccess = true;
                } else {
                    nightResults.deaths.push(target);
                }
            }
        }

        // 处理女巫解药
        if (actions.witchSave && !this.skillState.witch.antidoteUsed) {
            const saveTarget = actions.witchSave.target;
            if (nightResults.deaths.includes(saveTarget)) {
                // 移除死亡记录
                nightResults.deaths = nightResults.deaths.filter(d => d !== saveTarget);
                nightResults.saves.push(saveTarget);
                this.skillState.witch.antidoteUsed = true;
                
                const targetPlayer = this.gameState.alivePlayers.find(p => p.key === saveTarget);
                this.addGameLog(`女巫使用解药救了${targetPlayer.name}`, '系统');
            }
        }

        // 处理女巫毒药
        if (actions.witchPoison && !this.skillState.witch.poisonUsed) {
            const poisonTarget = actions.witchPoison.target;
            nightResults.deaths.push(poisonTarget);
            this.skillState.witch.poisonUsed = true;
            
            const targetPlayer = this.gameState.alivePlayers.find(p => p.key === poisonTarget);
            this.addGameLog(`女巫使用毒药毒杀了${targetPlayer.name}`, '系统');
        }

        // 处理预言家查验
        if (actions.prophetDivine) {
            const divineTarget = actions.prophetDivine.target;
            const targetPlayer = this.gameState.alivePlayers.find(p => p.key === divineTarget);
            
            if (targetPlayer) {
                // 检查是否为血月使徒（查验显示狼人）
                let result;
                if (targetPlayer.role === '血月使徒') {
                    result = '狼人';
                    this.addGameLog(`预言家查验了${targetPlayer.name}（血月使徒），结果为狼人`, '系统');
                } else {
                    const isWerewolf = targetPlayer.faction === 'werewolf';
                    result = isWerewolf ? '狼人' : '好人';
                    this.addGameLog(`预言家查验了${targetPlayer.name}，结果为${result}`, '系统');
                }
                
                nightResults.divineResults[divineTarget] = result;
            }
        }

        // 处理守卫守护
        if (actions.guardProtect) {
            const guardTarget = actions.guardProtect.target;
            
            // 检查是否可以守护（不能连续两晚守护同一人）
            if (guardTarget !== this.skillState.guard.lastGuarded) {
                this.gameState.guardedPlayers = [guardTarget];
                this.skillState.guard.lastGuarded = guardTarget;
                
                const targetPlayer = this.gameState.alivePlayers.find(p => p.key === guardTarget);
                this.addGameLog(`守卫选择守护${targetPlayer.name}`, '系统');
                nightResults.guardSuccess = true;
            } else {
                this.addGameLog('守卫不能连续两晚守护同一人', '系统');
            }
        }

        // 处理禁言长老禁言
        if (actions.silence) {
            const silenceTarget = actions.silence.target;
            
            // 检查是否可以禁言（不能连续两晚禁言同一人）
            if (silenceTarget !== this.skillState.silence.lastSilenced) {
                this.gameState.silencedPlayers = [silenceTarget];