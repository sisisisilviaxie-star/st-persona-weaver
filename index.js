// Persona Weaver Extension Logic
(function() {
    // === 0. 配置常量 ===
    const STORAGE_KEY_STATE = 'pw_current_state_v2';
    const STORAGE_KEY_HISTORY = 'pw_generation_history_v1';
    const MAX_HISTORY = 10;

    // === 检查依赖 ===
    function checkDependencies() {
        if (!window.TavernHelper) {
            console.error('[Persona Weaver] TavernHelper not found! This extension requires TavernHelper/JS-Slash-Runner.');
            if (window.toastr) toastr.error('[Persona Weaver] 缺少依赖：请安装 TavernHelper (JS-Slash-Runner) 插件');
            return false;
        }
        return true;
    }

    // === 1. 逻辑核心 ===

    const stateManager = {
        save: (data) => localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data)),
        load: () => {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } 
            catch { return {}; }
        },
        clear: () => localStorage.removeItem(STORAGE_KEY_STATE),
        
        getHistory: () => {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } 
            catch { return []; }
        },
        addHistory: (item) => {
            let hist = stateManager.getHistory();
            item.timestamp = new Date().toLocaleString();
            hist.unshift(item);
            if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
            localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(hist));
        },
        clearHistory: () => localStorage.removeItem(STORAGE_KEY_HISTORY)
    };

    async function getCurrentWorldbook() {
        const chatWb = window.TavernHelper.getChatWorldbookName('current');
        if (chatWb) return chatWb;
        const charWb = window.TavernHelper.getCharWorldbookNames('current');
        if (charWb && charWb.primary) return charWb.primary;
        if (charWb && charWb.additional && charWb.additional.length > 0) return charWb.additional[0];
        return null;
    }

    async function generatePersona(userRequest) {
        const char = window.TavernHelper.getCharData('current');
        if (!char) throw new Error("请先打开一个角色卡");

        const prompt = `
你是一个专业的小说设定助手。
任务：根据用户要求和当前角色卡，创建一个【用户角色 (User Persona)】。

【当前角色】${char.name}
【简介】${char.description}
【用户要求】${userRequest}

请返回 JSON 对象，包含：
1. "name": 角色名。
2. "description": 详细设定（第三人称，200字左右）。
3. "wi_entry": 世界书背景条目内容。

JSON示例：
{"name": "...", "description": "...", "wi_entry": "..."}
`;
        try {
            const result = await window.TavernHelper.generateRaw({
                user_input: prompt,
                ordered_prompts: ["user_input"],
            });
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("格式解析失败");
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error(e);
            throw e;
        }
    }

    async function showPersonaCreator() {
        if (!checkDependencies()) return;

        const char = window.TavernHelper.getCharData('current');
        if (!char) { toastr.warning("请先打开一个角色聊天"); return; }
        
        const currentWb = await getCurrentWorldbook();
        const savedState = stateManager.load();
        
        const $wrapper = $(`
            <div class="pw-wrapper" style="display:flex; flex-direction:column; height:100%;">
                <div class="pw-header">
                    <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定构思</div>
                    <div class="pw-header-tools">
                        <i class="fa-solid fa-trash-can pw-tool-btn" id="pw-btn-clear" title="清空"></i>
                        <i class="fa-solid fa-clock-rotate-left pw-tool-btn" id="pw-btn-history" title="历史"></i>
                    </div>
                </div>

                <div id="pw-view-editor" class="pw-view active">
                    <div class="pw-scroll-area">
                        <div>
                            <div class="pw-label">我的要求</div>
                            <textarea id="pw-request" class="pw-textarea" placeholder="例如：我是她的青梅竹马...">${savedState.request || ''}</textarea>
                            <button id="pw-btn-gen" class="pw-btn gen" style="margin-top:10px;">
                                <i class="fa-solid fa-bolt"></i> AI 生成 / 润色
                            </button>
                        </div>

                        <div id="pw-result-area" style="display:${savedState.hasResult ? 'block' : 'none'};">
                            <div style="border-top:1px dashed var(--smart-theme-border-color-1); margin: 5px 0 15px 0;"></div>
                            <div class="pw-label"><i class="fa-solid fa-check-circle"></i> 结果确认</div>
                            
                            <div class="pw-card">
                                <div>
                                    <span class="pw-label">角色名称</span>
                                    <input type="text" id="pw-res-name" class="pw-input" value="${savedState.name || ''}">
                                </div>
                                <div>
                                    <span class="pw-label">用户设定</span>
                                    <textarea id="pw-res-desc" class="pw-textarea" rows="4">${savedState.desc || ''}</textarea>
                                </div>
                                
                                ${currentWb ? `
                                <div style="margin-top:5px;">
                                    <input type="checkbox" id="pw-wi-toggle" ${savedState.wiEnabled !== false ? 'checked' : ''}>
                                    <label for="pw-wi-toggle" style="cursor:pointer; font-size:0.9em; font-weight:bold;">
                                        同步写入世界书 <span style="opacity:0.6; font-weight:normal;">(${currentWb})</span>
                                    </label>
                                    <div id="pw-wi-container" style="margin-top:5px;">
                                        <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目...">${savedState.wiContent || ''}</textarea>
                                    </div>
                                </div>
                                ` : ''}
                            </div>

                            <button id="pw-btn-save" class="pw-btn save"><i class="fa-solid fa-floppy-disk"></i> 保存并启用</button>
                        </div>
                    </div>
                </div>

                <div id="pw-view-history" class="pw-view">
                    <div class="pw-scroll-area" id="pw-history-list"></div>
                    <div style="padding:15px; border-top:1px solid var(--smart-theme-border-color-1);">
                        <button id="pw-btn-back" class="pw-btn gen" style="background:transparent; border:1px solid var(--smart-theme-border-color-1); color:var(--smart-theme-body-color);">
                            <i class="fa-solid fa-arrow-left"></i> 返回编辑
                        </button>
                        <div style="text-align:center; margin-top:10px;">
                            <span id="pw-btn-clear-hist" style="font-size:0.8em; opacity:0.6; cursor:pointer; text-decoration:underline;">清空所有历史</span>
                        </div>
                    </div>
                </div>
            </div>
        `);

        let popupInstance;

        const autoSave = () => {
            const state = {
                request: $wrapper.find('#pw-request').val(),
                hasResult: $wrapper.find('#pw-result-area').css('display') !== 'none',
                name: $wrapper.find('#pw-res-name').val(),
                desc: $wrapper.find('#pw-res-desc').val(),
                wiContent: $wrapper.find('#pw-res-wi').val(),
                wiEnabled: $wrapper.find('#pw-wi-toggle').is(':checked')
            };
            stateManager.save(state);
        };
        $wrapper.on('input change', 'input, textarea', autoSave);

        $wrapper.find('#pw-btn-gen').on('click', async function() {
            const request = $wrapper.find('#pw-request').val();
            if (!request.trim()) { toastr.warning("请输入要求"); return; }
            
            const $btn = $(this);
            const originalText = $btn.html();
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 生成中...');

            try {
                const data = await generatePersona(request);
                $wrapper.find('#pw-res-name').val(data.name);
                $wrapper.find('#pw-res-desc').val(data.description);
                if (currentWb) $wrapper.find('#pw-res-wi').val(data.wi_entry || data.description);
                $wrapper.find('#pw-result-area').fadeIn(200);
                stateManager.addHistory({ request, data });
                autoSave();
            } catch (e) {
                toastr.error("生成失败");
            } finally {
                $btn.prop('disabled', false).html(originalText);
            }
        });

        $wrapper.find('#pw-btn-clear').on('click', function() {
            if(confirm("确定清空当前内容吗？")) {
                $wrapper.find('input[type="text"], textarea').val('');
                $wrapper.find('#pw-result-area').slideUp(200);
                stateManager.clear();
            }
        });

        const renderHistory = () => {
            const list = stateManager.getHistory();
            const $con = $wrapper.find('#pw-history-list').empty();
            if (list.length === 0) { $con.html('<div class="pw-empty-tip">暂无历史记录</div>'); return; }

            list.forEach(item => {
                const $item = $(`
                    <div class="pw-history-item">
                        <div class="pw-history-time">${item.timestamp}</div>
                        <div class="pw-history-name">${item.data.name}</div>
                        <div class="pw-history-req">要求: ${item.request}</div>
                    </div>
                `);
                $item.on('click', () => {
                    $wrapper.find('#pw-request').val(item.request);
                    $wrapper.find('#pw-res-name').val(item.data.name);
                    $wrapper.find('#pw-res-desc').val(item.data.description);
                    if (currentWb) $wrapper.find('#pw-res-wi').val(item.data.wi_entry);
                    $wrapper.find('#pw-result-area').show();
                    autoSave();
                    $wrapper.find('#pw-btn-back').click();
                });
                $con.append($item);
            });
        };

        $wrapper.find('#pw-btn-history').on('click', function() {
            renderHistory();
            $wrapper.find('#pw-view-editor').removeClass('active');
            $wrapper.find('#pw-view-history').addClass('active');
            $wrapper.find('.pw-title').text('历史记录');
            $(this).hide(); $wrapper.find('#pw-btn-clear').hide();
        });

        $wrapper.find('#pw-btn-back').on('click', function() {
            $wrapper.find('#pw-view-history').removeClass('active');
            $wrapper.find('#pw-view-editor').addClass('active');
            $wrapper.find('.pw-title').html('<i class="fa-solid fa-wand-magic-sparkles"></i> 设定构思');
            $wrapper.find('#pw-btn-history').show(); $wrapper.find('#pw-btn-clear').show();
        });

        $wrapper.find('#pw-btn-clear-hist').on('click', function() {
            if(confirm("确定清空所有历史记录吗？")) {
                stateManager.clearHistory();
                renderHistory();
            }
        });

        $wrapper.find('#pw-btn-save').on('click', async function() {
            const name = $wrapper.find('#pw-res-name').val();
            const desc = $wrapper.find('#pw-res-desc').val();
            const wiContent = $wrapper.find('#pw-res-wi').val();
            const useWi = $wrapper.find('#pw-wi-toggle').is(':checked');

            if (!name) { toastr.warning("名字不能为空"); return; }
            const $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 保存中...');

            try {
                if (!SillyTavern.powerUserSettings.personas) SillyTavern.powerUserSettings.personas = {};
                SillyTavern.powerUserSettings.personas[name] = desc;
                await SillyTavern.saveSettingsDebounced();
                
                if (currentWb && useWi && wiContent) {
                    await window.TavernHelper.createWorldbookEntries(currentWb, [{
                        name: `[User] ${name}`,
                        keys: [name, "User", "用户"],
                        content: wiContent,
                        enabled: true,
                        strategy: { type: 'selective', keys: [name, "用户", "我"], keys_secondary: { keys: [], logic: 'and_any' } }
                    }]);
                    toastr.success(`已更新世界书`);
                }

                SillyTavern.powerUserSettings.persona_selected = name;
                $("#your_name").val(name).trigger("input").trigger("change");
                $("#your_desc").val(desc).trigger("input").trigger("change");
                
                toastr.success(`已切换为：${name}`);
                if (popupInstance) popupInstance.complete(SillyTavern.POPUP_RESULT.AFFIRMATIVE);
            } catch (e) {
                console.error(e);
                toastr.error("保存失败");
                $btn.prop('disabled', false).html('<i class="fa-solid fa-floppy-disk"></i> 保存并启用');
            }
        });

        if (window.SillyTavern && SillyTavern.Popup) {
            popupInstance = new SillyTavern.Popup(
                $wrapper, SillyTavern.POPUP_TYPE.TEXT, "",
                { large: true, okButton: "关闭", customClass: "pw-wide" }
            );
            popupInstance.show();
        }
    }

    // === 2. 注册 ===
    const initExtension = () => {
        // Slash 命令
        if (window.SillyTavern && SillyTavern.SlashCommandParser) {
            SillyTavern.SlashCommandParser.addCommandObject(SillyTavern.SlashCommand.fromProps({
                name: 'create-persona', callback: showPersonaCreator, helpString: '打开用户角色生成器'
            }));
        }

        // Script 按钮兼容
        if (window.TavernHelper && typeof window.replaceScriptButtons === 'function') {
            const BUTTON_NAME = '创建用户人设';
            window.replaceScriptButtons([{ name: BUTTON_NAME, visible: true }]);
            window.eventOn(window.getButtonEvent(BUTTON_NAME), showPersonaCreator);
        }

        // 顶部栏图标
        const btnId = 'persona-weaver-btn';
        $('#' + btnId).remove();
        const $btn = $('<div id="' + btnId + '" class="drawer-content-header-icon" title="用户角色生成器"><i class="fa-solid fa-user-pen"></i></div>');
        $btn.on('click', showPersonaCreator);
        const $target = $('#greeting-jumper-btn');
        if ($target.length) $btn.insertAfter($target);
        else $('#extensions_settings_button').before($btn);
    };

    // 等待 TavernHelper 加载
    let checkCount = 0;
    const loader = setInterval(() => {
        if (window.TavernHelper || checkCount > 20) {
            clearInterval(loader);
            initExtension();
        }
        checkCount++;
    }, 500);
})();
