/* Adapted from Chemiss: room transport and full theme designer. */
(()=>{
const COLOR_WHITE='white',COLOR_BLACK='black';
const game=window.game;
function closeModal(el){el.classList.remove('active');document.body.classList.remove('modal-open');}
            class OnlineManager {
                constructor(game) {
                    this.game = game;
                    this.client = null;
                    this.connected = false;
                    this.isHost = false;
                    this.localColor = null;
                    this.roomCode = null;
                    this._myId = 'p' + Math.random().toString(36).slice(2, 10);
                    this._peerOnline = false;
                    this._peerWasOnline = false;
                    this._presenceTimer = null;
                    this._presenceSeq = 0;
                    this._lastPeerPresence = 0;
                }
                _brokerUrls() {
                    // 多个可用免费 MQTT broker（国内优先）
                    const urls = [
                        'wss://broker.emqx.io:8084/mqtt',
                        'wss://broker-cn.emqx.io:8084/mqtt',
                        'wss://test.mosquitto.org:8081/mqtt',
                    ];
                    return [urls[Number(this.roomCode?.[0]) || 0]];
                }
                _genRoomCode() {
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    let s = '';
                    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
                    return String(this.game.onlineBrokerIndex || 0) + s;
                }
                _topic() { return 'bio-go-v1/' + this.roomCode; }
                _waitForMqtt(callback, timeoutMs) {
                    if (typeof mqtt !== 'undefined') { callback(); return; }
                    if (window._mqttError) {
                        this.game.addLog('MQTT库加载失败，请检查网络后刷新页面重试');
                        this.game._refreshOnlineUI();
                        return;
                    }
                    const start = Date.now();
                    const check = () => {
                        if (typeof mqtt !== 'undefined') { callback(); return; }
                        if (window._mqttError) {
                            this.game.addLog('MQTT库加载失败，请检查网络后刷新页面重试');
                            this.game._refreshOnlineUI();
                            return;
                        }
                        if (Date.now() - start > timeoutMs) {
                            this.game.addLog('MQTT库加载超时，请刷新页面重试');
                            this.game._refreshOnlineUI();
                            return;
                        }
                        setTimeout(check, 300);
                    };
                    setTimeout(check, 100);
                }
                hostGame() {
                    this.isHost = true; this.localColor = COLOR_BLACK;
                    this.roomCode = this._genRoomCode();
                    this._waitForMqtt(() => this._connect(), 15000);
                    return this.roomCode;
                }
                joinGame(roomCode) {
                    this.isHost = false; this.localColor = COLOR_WHITE;
                    this.roomCode = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (!/^[0123][A-Z0-9]{6}$/.test(this.roomCode)) return false;
                    this._waitForMqtt(() => this._connect(), 15000);
                    return true;
                }
                _connect(brokerIdx) {
                    if (brokerIdx === undefined) brokerIdx = 0;
                    const urls = this._brokerUrls();
                    if (brokerIdx >= urls.length) {
                        this.error = '当前服务器连接失败，请更换服务器后重新创建房间。';
                        this.game.addLog(this.error);
                        this.game._refreshOnlineUI();
                        return;
                    }
                    if (typeof mqtt === 'undefined') {
                        this.game.addLog('MQTT库未就绪，请稍后重试');
                        this.game._refreshOnlineUI();
                        return;
                    }
                    const topic = this._topic();
                    const brokerUrl = urls[brokerIdx];
                    console.log('[MQTT] 尝试连接: ' + brokerUrl);
                    this.error = null;
                    const transport = this.roomCode[0] === '3' ? window.ParityLAN : mqtt;
                    this.client = transport.connect(brokerUrl, {
                        clientId: 'chemis_' + this._myId + '_' + Date.now().toString(36),
                        clean: true,
                        connectTimeout: 8000,
                        reconnectPeriod: 5000,
                        keepalive: 60,
                    });
                    let settled = false;
                    const settle = (ok) => {
                        if (this._stopped || settled) return;
                        settled = true;
                        if (!ok) {
                            // 尝试下一个 broker
                            console.log('[MQTT] 切换备用服务器...');
                            if (this.client) { try { this.client.end(true); } catch (_) {} this.client = null; }
                            this._connect(brokerIdx + 1);
                        }
                    };
                    const timeoutId = setTimeout(() => {
                        if (this._stopped) return;
                        this.game.addLog('服务器连接超时，请更换服务器后重建房间。');
                        settle(false);
                    }, 10000);
                    this.client.on('connect', () => {
                        clearTimeout(timeoutId);
                        if (this._stopped || (settled && this.connected)) return;
                        console.log('[MQTT] 已连接 broker: ' + brokerUrl);
                        this.game.addLog(`已连接服务器，加入房间 ${this.roomCode}…`);
                        this.client.subscribe(topic, (err) => {
                            if (err) {
                                console.error('[MQTT] 订阅失败', err);
                                settle(false);
                                return;
                            }
                            if (!this.connected) {
                                this.connected = true;
                                this.game._onOnlineConnected();
                                // 发送在线通知（让对等方知道你来了）
                                this._sendPresence();
                                this._startPresenceTimer();
                            }
                            settle(true);
                        });
                    });
                    this.client.on('message', (tpc, payload) => {
                        try {
                            const msg = JSON.parse(payload.toString());
                            if (msg._sender === this._myId) return;
                            // 处理在线通知
                            if (msg.type === 'presence') {
                                this._peerOnline = true;
                                this._lastPeerPresence = Date.now();
                                if (!this._peerWasOnline) {
                                    this._peerWasOnline = true;
                                    this.game.addLog(this.game._t('peerJoined'));
                                }
                                this.game._refreshOnlineUI();
                                return;
                            }
                            if (msg.type === 'presenceAck') {
                                this._peerOnline = true;
                                this._lastPeerPresence = Date.now();
                                this.game._refreshOnlineUI();
                                return;
                            }
                            this.game._onRemoteMessage(msg);
                        } catch (_) {}
                    });
                    this.client.on('error', (e) => {
                        console.error('[MQTT] 连接错误', e);
                        if (!settled) {
                            this.game.addLog(`连接错误: ${e.message || '未知错误'}`);
                            clearTimeout(timeoutId);
                            settle(false);
                        }
                    });
                    this.client.on('close', () => {
                        console.log('[MQTT] 连接关闭');
                        if (settled) clearTimeout(timeoutId);
                        this._stopPresenceTimer();
                        if (this.connected) {
                            this.connected = false;
                            this._peerOnline = false;
                            this._peerWasOnline = false;
                            this.game._onOnlineDisconnected();
                        }
                    });
                    this.client.on('offline', () => {
                        console.log('[MQTT] 离线');
                    });
                    this.client.on('reconnect', () => {
                        console.log('[MQTT] 重连中...');
                    });
                    this.client.on('disconnect', () => {
                        console.log('[MQTT] 断开连接');
                    });
                }
                _startPresenceTimer() {
                    this._stopPresenceTimer();
                    this._presenceTimer = setInterval(() => {
                        if (!this.client || !this.client.connected) return;
                        this._sendPresence();
                        // 检测对等方是否超时断线（超过20秒没有收到presence）
                        if (this._peerOnline && Date.now() - this._lastPeerPresence > 25000) {
                            this._peerOnline = false;
                            this._peerWasOnline = false;
                            this.game.addLog(this.game._t('peerLeft'));
                            this.game._refreshOnlineUI();
                        }
                    }, 8000);
                }
                _stopPresenceTimer() {
                    if (this._presenceTimer) { clearInterval(this._presenceTimer); this._presenceTimer = null; }
                }
                _sendPresence() {
                    if (!this.client || !this.client.connected) return;
                    this._presenceSeq++;
                    this.send({
                        type: 'presence',
                        seq: this._presenceSeq,
                        color: this.localColor,
                    });
                }
                send(msg) {
                    if (!this.client || !this.client.connected) return false;
                    msg._sender = this._myId;
                    try {
                        this.client.publish(this._topic(), JSON.stringify(msg));
                        return true;
                    } catch(e) {
                        console.error('[MQTT] 发送失败', e);
                        return false;
                    }
                }
                disconnect() {
                    this._stopped = true;
                    this._stopPresenceTimer();
                    if (this.client) {
                        try {
                            this.send({ type: 'goodbye' });
                            this.client.end(true);
                        } catch (_) {}
                        this.client = null;
                    }
                    this.connected = false;
                    this._peerOnline = false;
                    this._peerWasOnline = false;
                }
            }


window.ParityOnline=OnlineManager;
            var ThemeManager = (() => {
                const DEFAULTS = {
                    whiteCell: '#dfc69c', blackCell: '#544534', bodyBg: '#f9f9f9',
                    boardBg: '#eaeaea', boardBorder: '#cccccc', legalMove: '#bfbfbf',
                    wpStart: '#ffffff', wpEnd: '#f0f0f0', wpColor: '#1a1a1a',
                    bpStart: '#222222', bpEnd: '#1a1a1a', bpColor: '#f0f0f0',
                    dotWhite: '#1a1a1a', dotBlack: '#f2f2f2', selected: '#bfbfbf',
                    panelBg: 'rgba(255,255,255,0.72)', panelColor: '#222222', panelHeading: '#333333', panelBorder: '#dddddd',
                    bondGlow: '#666666',
                    shape: 'circle', radius: 12
                };
                const PRESETS = {
                    classic: { ...DEFAULTS },
                    dark: {
                        whiteCell: '#2c2c2c', blackCell: '#a8a29a', bodyBg: '#1a1a1a',
                        boardBg: '#333333', boardBorder: '#555555', legalMove: '#888888',
                        wpStart: '#e0e0e0', wpEnd: '#c8c8c8', wpColor: '#1a1a1a',
                        bpStart: '#3a3a3a', bpEnd: '#1a1a1a', bpColor: '#e0e0e0',
                        dotWhite: '#1a1a1a', dotBlack: '#e0e0e0', selected: '#888888',
                        panelBg: 'rgba(42,42,42,0.78)', panelColor: '#eeeeee', panelHeading: '#dddddd', panelBorder: '#555555',
                        bondGlow: '#bbbbbb',
                        shape: 'circle', radius: 12, _darkMode: true
                    },
                    blue: {
                        whiteCell: '#eef0f2', blackCell: '#7fa0b6', bodyBg: '#f0f2f4',
                        boardBg: '#d8e0e8', boardBorder: '#b0c0d0', legalMove: '#9ab0c4',
                        wpStart: '#ffffff', wpEnd: '#f0f2f4', wpColor: '#1a1a2a',
                        bpStart: '#2a3a4a', bpEnd: '#1a2a3a', bpColor: '#e0e8f0',
                        dotWhite: '#1a1a2a', dotBlack: '#e0e8f0', selected: '#9ab0c4',
                        panelBg: 'rgba(240,242,244,0.78)', panelColor: '#1a2a3a', panelHeading: '#4a7a9a', panelBorder: '#b0c0d0',
                        bondGlow: '#666666',
                        shape: 'circle', radius: 12
                    },
                    marble: {
                        whiteCell: '#f5f0e0', blackCell: '#d4c8a8', bodyBg: '#e8e0d0',
                        boardBg: '#c0b8a8', boardBorder: '#a09888', legalMove: '#b8a888',
                        wpStart: '#fff8f0', wpEnd: '#f0e8d8', wpColor: '#2a1a0a',
                        bpStart: '#3a2a1a', bpEnd: '#2a1a0a', bpColor: '#f0e8d0',
                        dotWhite: '#2a1a0a', dotBlack: '#f0e8d0', selected: '#b8a888',
                        panelBg: 'rgba(232,224,208,0.78)', panelColor: '#2a1a0a', panelHeading: '#8a7050', panelBorder: '#a09888',
                        bondGlow: '#666666',
                        shape: 'circle', radius: 12
                    },
                    darkwood: {
                        whiteCell: '#d4b896', blackCell: '#8b6914', bodyBg: '#3a2f28',
                        boardBg: '#5c3d2e', boardBorder: '#7a5c43', legalMove: '#b8a088',
                        wpStart: '#f5f0e8', wpEnd: '#e8d5c0', wpColor: '#2a1a10',
                        bpStart: '#3a2a1a', bpEnd: '#1f0f05', bpColor: '#f0e0c0',
                        dotWhite: '#2a1a10', dotBlack: '#f0e0c0', selected: '#b8a088',
                        panelBg: 'rgba(60,45,35,0.78)', panelColor: '#e0d5c0', panelHeading: '#c4a48a', panelBorder: '#7a5c43',
                        bondGlow: '#606660',
                        shape: 'circle', radius: 12
                    },
                    ocean: {
                        whiteCell: '#e8f4f8', blackCell: '#b0c4de', bodyBg: '#1a2a3a',
                        boardBg: '#2a4a6a', boardBorder: '#4a7a9a', legalMove: '#7a9aba',
                        wpStart: '#f0f8ff', wpEnd: '#d0e8ff', wpColor: '#0a1a2a',
                        bpStart: '#0a1a2a', bpEnd: '#1a2a4a', bpColor: '#d0e8f0',
                        dotWhite: '#0a1a2a', dotBlack: '#d0e8f0', selected: '#7a9aba',
                        panelBg: 'rgba(26,42,58,0.78)', panelColor: '#d0e8f0', panelHeading: '#7a9aba', panelBorder: '#4a7a9a',
                        bondGlow: '#666666',
                        shape: 'circle', radius: 12
                    },
                    forest: {
                        whiteCell: '#e8f0e0', blackCell: '#a0c0a0', bodyBg: '#1a2a1a',
                        boardBg: '#2a4a2a', boardBorder: '#4a6a4a', legalMove: '#8aaa8a',
                        wpStart: '#f0fff0', wpEnd: '#d0f0d0', wpColor: '#0a1a0a',
                        bpStart: '#0a1a0a', bpEnd: '#1a2a1a', bpColor: '#d0e8d0',
                        dotWhite: '#0a1a0a', dotBlack: '#d0e8d0', selected: '#8aaa8a',
                        panelBg: 'rgba(26,42,26,0.78)', panelColor: '#d0e8d0', panelHeading: '#8aaa8a', panelBorder: '#4a6a4a',
                        bondGlow: '#606660',
                        shape: 'circle', radius: 12
                    },
                    sunset: {
                        whiteCell: '#fff0e8', blackCell: '#e0c0a0', bodyBg: '#3a2a1a',
                        boardBg: '#5a3a2a', boardBorder: '#8a5a3a', legalMove: '#c0a080',
                        wpStart: '#fff8f0', wpEnd: '#ffe0d0', wpColor: '#2a0a0a',
                        bpStart: '#2a0a0a', bpEnd: '#3a1a0a', bpColor: '#f0d8c0',
                        dotWhite: '#2a0a0a', dotBlack: '#f0d8c0', selected: '#c0a080',
                        panelBg: 'rgba(58,42,26,0.78)', panelColor: '#f0d8c0', panelHeading: '#c0a080', panelBorder: '#8a5a3a',
                        bondGlow: '#666666',
                        shape: 'rounded', radius: 18
                    }
                };
                const STORAGE_KEY = 'bio_go_theme';
                let current = { ...DEFAULTS, shape: 'circle', radius: 12 };
                let activePreset = 'classic';

                function load() {
                    try {
                        const raw = localStorage.getItem(STORAGE_KEY);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                                Object.assign(current, parsed);
                                activePreset = current._preset || 'classic';
                                if (current._darkMode) document.body.classList.add('dark-mode');
                                else document.body.classList.remove('dark-mode');
                                apply();
                                return;
                            }
                        }
                    } catch (_) {}
                    // 无已保存主题：不覆盖默认CSS变量，保留dark-mode等CSS规则优先
                }

                function save() {
                    try { current._preset = activePreset; localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
                }

                function apply() {
                    const v = (val) => String(val || '');
                    const root = document.documentElement;
                    if (current._darkMode) document.body.classList.add('dark-mode');
                    else document.body.classList.remove('dark-mode');
                    root.style.setProperty('--white-cell', v(current.whiteCell));
                    root.style.setProperty('--black-cell', v(current.blackCell));
                    root.style.setProperty('--body-bg', v(current.bodyBg));
                    root.style.setProperty('--board-wrapper-bg', v(current.boardBg));
                    root.style.setProperty('--board-border-color', v(current.boardBorder));
                    root.style.setProperty('--legal-move', v(current.legalMove));
                    root.style.setProperty('--white-piece-start', v(current.wpStart));
                    root.style.setProperty('--white-piece-end', v(current.wpEnd));
                    root.style.setProperty('--white-piece-color', v(current.wpColor));
                    root.style.setProperty('--black-piece-start', v(current.bpStart));
                    root.style.setProperty('--black-piece-end', v(current.bpEnd));
                    root.style.setProperty('--black-piece-color', v(current.bpColor));
                    root.style.setProperty('--dot-white', v(current.dotWhite));
                    root.style.setProperty('--dot-black', v(current.dotBlack));
                    root.style.setProperty('--selected', v(current.selected));
                    root.style.setProperty('--side-panel-bg', v(current.panelBg));
                    root.style.setProperty('--side-panel-color', v(current.panelColor));
                    root.style.setProperty('--side-panel-heading', v(current.panelHeading));
                    root.style.setProperty('--panel-bg', v(current.panelBg));
                    root.style.setProperty('--panel-text', v(current.panelColor));
                    root.style.setProperty('--panel-border', v(current.panelBorder));
                    root.style.setProperty('--bond-glow', v(current.bondGlow));
                    root.style.setProperty('--piece-radius', current.shape === 'rounded' ? current.radius + '%' : '50%');
                    syncUI();
                    if (typeof game !== 'undefined' && game.updateUI) game.updateUI();
                    // 面板颜色在重绘后强制应用（避免被 renderBoard DOM 替换冲刷）
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const sp2 = document.getElementById('sidePanel');
                            if (sp2) {
                                sp2.style.setProperty('background', v(current.panelBg), 'important');
                                sp2.style.setProperty('color', v(current.panelColor), 'important');
                                const sh2 = sp2.querySelector('h2');
                                if (sh2) sh2.style.setProperty('color', v(current.panelHeading), 'important');
                                // 所有 info-section 子元素
                                sp2.querySelectorAll('.info-section').forEach(el => {
                                    el.style.setProperty('background', v(current.panelBg), 'important');
                                    el.style.setProperty('color', v(current.panelColor), 'important');
                                });
                            }
                            document.querySelectorAll('.settings-icon-btn').forEach(b => {
                                b.style.setProperty('background', v(current.panelBg), 'important');
                                b.style.setProperty('border-color', v(current.panelBorder), 'important');
                            });
                            document.querySelectorAll('.modal').forEach(m => {
                                m.style.setProperty('background', v(current.panelBg), 'important');
                                m.style.setProperty('color', v(current.panelColor), 'important');
                            });
                            const reviewContainer = document.getElementById('reviewOverlay');
                            if (reviewContainer) {
                                reviewContainer.style.setProperty('color', v(current.panelColor), 'important');
                            }
                            const reviewSideCol = document.querySelector('.review-side-col');
                            if (reviewSideCol) {
                                reviewSideCol.style.setProperty('color', v(current.panelColor), 'important');
                            }
                        });
                    });
                }

                function reset() {
                    Object.assign(current, DEFAULTS);
                    current.shape = 'circle';
                    current.radius = 12;
                    current._darkMode = false;
                    activePreset = 'classic';
                    document.body.classList.remove('dark-mode');
                    apply(); save();
                }

                function set(key, value) { current[key] = value; if (key !== 'shape' && key !== 'radius') activePreset = 'custom'; }

                function applyPreset(name) {
                    const preset = PRESETS[name];
                    if (!preset) return;
                    Object.assign(current, { ...preset });
                    current._darkMode = preset._darkMode === true; // 显式设置，防止残留
                    activePreset = name;
                    if (current._darkMode) {
                        document.body.classList.add('dark-mode');
                    } else {
                        document.body.classList.remove('dark-mode');
                    }
                    apply(); save();
                }

                function syncUI() {
                    const ids = {
                        whiteCell: 'tcWhiteCell', blackCell: 'tcBlackCell', bodyBg: 'tcBodyBg',
                        boardBg: 'tcBoardBg', boardBorder: 'tcBoardBorder', legalMove: 'tcLegalMove',
                        wpStart: 'tcWPStart', wpEnd: 'tcWPEnd', wpColor: 'tcWPColor',
                        bpStart: 'tcBPStart', bpEnd: 'tcBPEnd', bpColor: 'tcBPColor',
                        dotWhite: 'tcDotWhite', dotBlack: 'tcDotBlack', selected: 'tcSelected',
                        panelBg: 'tcPanelBg', panelColor: 'tcPanelColor', panelHeading: 'tcPanelHeading'
                    };
                    const toHex = (c) => {
                        if (typeof c === 'string' && c.startsWith('rgba')) {
                            const m = c.match(/[\d.]+/g);
                            if (m && m.length >= 3) {
                                return '#' + [m[0], m[1], m[2]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
                            }
                        }
                        return c || '#000000';
                    };
                    for (const [key, id] of Object.entries(ids)) {
                        const el = document.getElementById(id);
                        if (el) el.value = toHex(current[key]);
                    }
                    const shapeCircle = document.getElementById('themeShapeCircle');
                    const shapeRounded = document.getElementById('themeShapeRounded');
                    const radiusRow = document.getElementById('themeRadiusRow');
                    const radiusSlider = document.getElementById('themeRadiusSlider');
                    const radiusVal = document.getElementById('themeRadiusVal');
                    if (shapeCircle && shapeRounded) {
                        shapeCircle.classList.toggle('active', current.shape === 'circle');
                        shapeRounded.classList.toggle('active', current.shape === 'rounded');
                    }
                    if (radiusRow) radiusRow.style.display = current.shape === 'rounded' ? 'flex' : 'none';
                    if (radiusSlider) radiusSlider.value = current.radius;
                    if (radiusVal) radiusVal.textContent = current.radius + '%';
                    // 预设芯⽚
                    document.querySelectorAll('#themePresetChips .theme-preset-chip').forEach(chip => {
                        chip.classList.toggle('active', chip.dataset.preset === activePreset);
                    });
                }

                return { DEFAULTS, PRESETS, load, save, apply, reset, set, applyPreset, syncUI, getCurrent: () => current, getActivePreset: () => activePreset };
            })();

            function openThemeModal() {
                ThemeManager.syncUI();
                document.getElementById('themeModal').classList.add('active');
                document.body.classList.add('modal-open');
            }
            function closeThemeModal() {
                closeModal(document.getElementById('themeModal'));
            }
            document.getElementById('themeModal').addEventListener('click', function(e) {
                if (e.target === this) closeThemeModal();
            });

            // 预设主题点击
            document.getElementById('themePresetChips').addEventListener('click', (e) => {
                const chip = e.target.closest('.theme-preset-chip');
                if (!chip) return;
                const presetName = chip.dataset.preset;
                ThemeManager.applyPreset(presetName);
                document.querySelectorAll('#themePresetChips .theme-preset-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });

            // 颜色输入器实时预览
            const themeColorMap = {
                tcWhiteCell: 'whiteCell', tcBlackCell: 'blackCell', tcBodyBg: 'bodyBg',
                tcBoardBg: 'boardBg', tcBoardBorder: 'boardBorder', tcLegalMove: 'legalMove',
                tcWPStart: 'wpStart', tcWPEnd: 'wpEnd', tcWPColor: 'wpColor',
                tcBPStart: 'bpStart', tcBPEnd: 'bpEnd', tcBPColor: 'bpColor',
                tcDotWhite: 'dotWhite', tcDotBlack: 'dotBlack', tcSelected: 'selected',
                tcPanelBg: 'panelBg', tcPanelColor: 'panelColor', tcPanelHeading: 'panelHeading'
            };
            document.querySelectorAll('.theme-color-input').forEach(input => {
                input.addEventListener('input', () => {
                    const key = themeColorMap[input.id];
                    if (!key) return;
                    ThemeManager.set(key, input.value);
                    ThemeManager.set('_darkMode', false);
                    ThemeManager.apply();
                    document.querySelectorAll('#themePresetChips .theme-preset-chip').forEach(c => c.classList.remove('active'));
                });
            });

            // 形状切换
            document.getElementById('themeShapeCircle').addEventListener('click', () => {
                ThemeManager.set('shape', 'circle');
                document.getElementById('themeRadiusRow').style.display = 'none';
                document.getElementById('themeShapeCircle').classList.add('active');
                document.getElementById('themeShapeRounded').classList.remove('active');
                ThemeManager.apply(); ThemeManager.save();
            });
            document.getElementById('themeShapeRounded').addEventListener('click', () => {
                ThemeManager.set('shape', 'rounded');
                document.getElementById('themeRadiusRow').style.display = 'flex';
                document.getElementById('themeShapeRounded').classList.add('active');
                document.getElementById('themeShapeCircle').classList.remove('active');
                ThemeManager.apply(); ThemeManager.save();
            });

            // 圆角滑块
            document.getElementById('themeRadiusSlider').addEventListener('input', () => {
                const val = parseInt(document.getElementById('themeRadiusSlider').value);
                document.getElementById('themeRadiusVal').textContent = val + '%';
                ThemeManager.set('radius', val);
                ThemeManager.apply(); ThemeManager.save();
            });

            // 应用/重置按钮
            document.getElementById('themeBtnSave').addEventListener('click', () => {
                ThemeManager.save();
                closeThemeModal();
            });
            document.getElementById('themeBtnReset').addEventListener('click', () => {
                ThemeManager.reset();
                closeThemeModal();
            });

            // 桌面端主题按钮
            const btnTheme = document.getElementById('btnTheme');
            if (btnTheme) btnTheme.addEventListener('click', openThemeModal);

            // 加载已保存主题
            if (typeof ThemeManager !== 'undefined') ThemeManager.load();


window.ParityTheme=ThemeManager;
})();
