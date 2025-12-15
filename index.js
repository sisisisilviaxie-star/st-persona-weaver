import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_generation_history_v1';
const STORAGE_KEY_STATE = 'pw_current_state_v2'; // 更新版本号以免冲突

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 10,
    defaultOutputFormat: 'list' // 'list' | 'paragraph'
};

// UI Text Constants
const TEXT = {
    PANEL_TITLE: "用户设定编织者 ✒️",
    BTN_OPEN_MAIN: "✨ 打开设定生成器",
    BTN_OPEN_DESC: "AI 辅助生成用户人设、属性表并同步世界书",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_GEN_FAIL: "AI 生成失败，请检查连接",
    TOAST_SAVE_SUCCESS: (name) => `已保存并切换为: ${name}`,
    TOAST_WI_SUCCESS: (book) => `已更新世界书: ${book}`,
    TEMPLATE_CONTENT: `姓名：
年龄：
职业/身份：
外貌特征：
性格特点：
与当前角色的关系：
特殊能力/背景：`
};

// ============================================================================
// STATE & UTILS
// ============================================================================

let historyCache = [];

function loadHistory() {
    try {
        historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || [];
    } catch { historyCache = []; }
}

function saveHistory(item) {
    item.timestamp = new Date().toLocaleString();
    historyCache.unshift(item);
    if (historyCache.length > extension_settings[extensionName].historyLimit) {
        historyCache = historyCache.slice(0, extension_settings[extensionName].historyLimit);
    }
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveState(data) {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
}

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {};
    } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css';
    if ($(`#${styleId}`).length) return;

    const css = `
    .pw-wrapper { display: flex; flex-direction: column; height: 100%; text-align: left; font-size: 0.95em; }
    .pw-header { padding: 12px; border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; justify-content: space-between; align-items: center; background: var(--SmartThemeBg); }
    .pw-title { font-weight: bold; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
    .pw-tools i { cursor: pointer; margin-left: 15px; opacity: 0.7; transition: 0.2s; font-size: 1.1em; }
    .pw-tools i:hover { opacity: 1; transform: scale(1.1); color: var(--SmartThemeQuoteColor); }
    
    .pw-scroll-area { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }
    
    .pw-section { display: flex; flex-direction: column; gap: 8px; }
    .pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
    
    /* Input Tools Bar */
    .pw-input-tools { display: flex; gap: 10px; margin-bottom: 5px; font-size: 0.85em; }
    .pw-text-btn { cursor: pointer; color: var(--SmartThemeQuoteColor); font-weight: bold; opacity: 0.9; text-decoration: underline; }
    .pw-text-btn:hover { opacity: 1; }

    /* Output Format Toggle */
    .pw-fmt-toggle { display: flex; background: var(--black30a); padding: 3px; border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); }
    .pw-fmt-opt { flex: 1; text-align: center; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 0.85em; opacity: 0.7; transition: 0.2s; }
    .pw-fmt-opt.active { background: var(--SmartThemeQuoteColor); color: white; opacity: 1; font-weight: bold; }

    .pw-textarea { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); border-radius: 6px; padding: 10px; resize: vertical; min-height: 100px; box-sizing: border-box; line-height: 1.5; font-family: inherit; }
    .pw-textarea:focus { outline: 2px solid var(--SmartThemeQuoteColor); border-color: transparent; }
    
    .pw-input { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 8px; border-radius: 6px; box-sizing: border-box; }
    
    .pw-card { background: var(--black10a); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    
    .pw-btn { border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; color: white; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; }
    .pw-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .pw-btn.gen { background: var(--SmartThemeQuoteColor); margin-top: 5px; }
    .pw-btn.save { background: var(--SmartThemeEmColor); }
    .pw-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; filter: grayscale(0.5); }

    .pw-history-item { padding: 12px; border-bottom: 1px solid var(--SmartThemeBorderColor); cursor: pointer; transition: 0.2s; border-radius: 6px; margin-bottom: 5px; background: var(--black10a); }
    .pw-history-item:hover { background: var(--white10a); transform: translateX(3px); }
    
    .pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; }
    .pw-view.active { display: flex; }
    `;
    $('<style>').attr('id', styleId).html(css).appendTo('head');
}

// ============================================================================
// CORE LOGIC
// ============================================================================

async function getCurrentWorldbook() {
    const context = getContext();
    if (context.chatMetadata && context.chatMetadata.world_info) return context.chatMetadata.world_info;
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        const world = data.extensions?.world || data.world || data.character_book?.name;
        if (world && typeof world === 'string') return world;
    }
    return null;
}

async function generatePersona(userRequest, outputFormat = 'list') {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined) throw new Error("No character selected");
    
    const char = context.characters[charId];
    
    // Construct Format Instruction
    let formatInst = "";
    if (outputFormat === 'list') {
        formatInst = `
        "description": "Output strictly as an Attribute List / Character Sheet format. Use newlines. Example:\nName: ...\nAge: ...\nAppearance: ...\nPersonality: ...\nBackground: ...\n\n(Ensure content is detailed, approx 200 words total)"`;
    } else {
        formatInst = `
        "description": "Output as a narrative, descriptive paragraph in third person. (Approx 200 words)"`;
    }

    const prompt = `
Task: Create a User Persona based on the user's request and the current character's context.
Current Character: ${char.name}
Scenario: ${char.scenario || "None"}

User Request/Profile:
${userRequest}

Return ONLY a JSON object with this format:
{
    "name": "Name of the persona",
    ${formatInst},
    "wi_entry": "Background facts about this persona suitable for World Info/Lorebook (Key facts only)."
}`;

    try {
        const generatedText = await context.generateQuietPrompt(prompt, false, false, "System");
        const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse JSON from AI response");
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error("Persona Weaver Generation Error:", e);
        throw e;
    }
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) {
        toastr.warning(TEXT.TOAST_NO_CHAR, TEXT.PANEL_TITLE);
        return;
    }

    loadHistory();
    const savedState = loadState();
    const currentWb = await getCurrentWorldbook();
    
    // 默认输出格式状态
    let currentFormat = savedState.format || extension_settings[extensionName].defaultOutputFormat || 'list';

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定构思</div>
            <div class="pw-tools">
                <i class="fa-solid fa-eraser" id="pw-clear" title="清空内容"></i>
                <i class="fa-solid fa-clock-rotate-left" id="pw-history" title="历史记录"></i>
            </div>
        </div>

        <!-- Editor View -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                
                <!-- Input Section -->
                <div class="pw-section">
                    <div class="pw-label">
                        <span>我的要求 / 设定填空</span>
                        <div class="pw-input-tools">
                            <span class="pw-text-btn" id="pw-fill-template"><i class="fa-solid fa-clipboard-list"></i> 插入填写模板</span>
                        </div>
                    </div>
                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入你的要求，或者点击上方“插入填写模板”...">${savedState.request || ''}</textarea>
                    
                    <div class="pw-label" style="margin-top:5px;">生成结果格式</div>
                    <div class="pw-fmt-toggle">
                        <div class="pw-fmt-opt ${currentFormat === 'list' ? 'active' : ''}" data-fmt="list">
                            <i class="fa-solid fa-list-ul"></i> 属性表 (推荐)
                        </div>
                        <div class="pw-fmt-opt ${currentFormat === 'paragraph' ? 'active' : ''}" data-fmt="paragraph">
                            <i class="fa-solid fa-paragraph"></i> 小说段落
                        </div>
                    </div>

                    <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> AI 生成 / 润色</button>
                </div>

                <!-- Result Section -->
                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}">
                    <div style="border-top: 1px dashed var(--SmartThemeBorderColor); margin: 5px 0 15px 0;"></div>
                    <div class="pw-label"><i class="fa-solid fa-check-circle"></i> 结果确认</div>
                    
                    <div class="pw-card">
                        <div>
                            <span class="pw-label">角色名称 (Name)</span>
                            <input type="text" id="pw-res-name" class="pw-input" value="${savedState.name || ''}">
                        </div>
                        <div>
                            <span class="pw-label">用户设定 (Description)</span>
                            <textarea id="pw-res-desc" class="pw-textarea" rows="6">${savedState.desc || ''}</textarea>
                        </div>
                        
                        ${currentWb ? `
                        <div style="margin-top:5px; display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="pw-wi-toggle" ${extension_settings[extensionName].syncToWorldInfo ? 'checked' : ''}>
                            <label for="pw-wi-toggle" style="font-size: 0.9em; cursor: pointer; font-weight:bold;">
                                同步写入世界书 <span style="opacity:0.6; font-weight:normal;">(${currentWb})</span>
                            </label>
                        </div>
                        <div id="pw-wi-container" style="margin-top: 5px;">
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目内容...">${savedState.wiContent || ''}</textarea>
                        </div>
                        ` : '<div style="opacity:0.5; font-size:0.8em; font-style:italic; margin-top:5px;">未检测到绑定世界书</div>'}
                    </div>

                    <button id="pw-btn-save" class="pw-btn save"><i class="fa-solid fa-floppy-disk"></i> 保存并启用</button>
                </div>
            </div>
        </div>

        <!-- History View -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area" id="pw-history-list"></div>
            <div style="padding: 15px; border-top: 1px solid var(--SmartThemeBorderColor); text-align: center;">
                <button id="pw-btn-back" class="pw-btn" style="background:transparent; border:1px solid var(--SmartThemeBorderColor); color:var(--SmartThemeBodyColor); width:auto; display:inline-flex;">
                    <i class="fa-solid fa-arrow-left"></i> 返回编辑
                </button>
            </div>
        </div>
    </div>
    `;

    // Show Popup
    await callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // === Event Binding ===
    const $popup = $('.swal2-popup');
    
    // State Saver
    const autoSave = () => {
        saveState({
            request: $('#pw-request').val(),
            format: currentFormat,
            hasResult: $('#pw-result-area').css('display') !== 'none',
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val()
        });
    };
    $popup.on('input change', 'input, textarea', autoSave);

    // Format Toggle
    $('.pw-fmt-opt').on('click', function() {
        $('.pw-fmt-opt').removeClass('active');
        $(this).addClass('active');
        currentFormat = $(this).data('fmt');
        autoSave();
    });

    // Fill Template
    $('#pw-fill-template').on('click', function() {
        const currentVal = $('#pw-request').val();
        if (currentVal.trim() !== "" && !confirm("输入框已有内容，确定要追加模板吗？")) return;
        
        const newVal = currentVal ? currentVal + "\n\n" + TEXT.TEMPLATE_CONTENT : TEXT.TEMPLATE_CONTENT;
        $('#pw-request').val(newVal).focus();
        autoSave();
    });

    // Generate
    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        if (!req.trim()) return toastr.warning("请输入要求");

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 正在生成...');

        try {
            const data = await generatePersona(req, currentFormat);
            
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            saveHistory({ request: req, format: currentFormat, data: data });
            autoSave();
        } catch (e) {
            toastr.error(TEXT.TOAST_GEN_FAIL);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // Save
    $('#pw-btn-save').on('click', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        const syncWi = $('#pw-wi-toggle').is(':checked');

        if (!name) return toastr.warning("名字不能为空");

        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 保存中...');

        try {
            const context = getContext();
            
            // 1. Save Persona
            if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
            context.powerUserSettings.personas[name] = desc;
            await saveSettingsDebounced();

            // 2. Sync World Info
            if (currentWb && syncWi && wiContent) {
                const headers = getRequestHeaders();
                // Get WB Data
                const getRes = await fetch('/api/worldinfo/get', { 
                    method: 'POST', headers, body: JSON.stringify({ name: currentWb }) 
                });
                
                if (getRes.ok) {
                    const bookData = await getRes.json();
                    if (!bookData.entries) bookData.entries = {};
                    
                    const ids = Object.keys(bookData.entries).map(Number);
                    const newId = ids.length ? Math.max(...ids) + 1 : 0;
                    
                    bookData.entries[newId] = {
                        uid: newId,
                        key: [name, "User", "用户"],
                        keysecondary: [],
                        comment: `[User] ${name}`,
                        content: wiContent,
                        constant: false,
                        selective: true,
                        enabled: true
                    };
                    
                    await fetch('/api/worldinfo/edit', {
                        method: 'POST', headers, body: JSON.stringify({ name: currentWb, data: bookData })
                    });
                    
                    toastr.success(TEXT.TOAST_WI_SUCCESS(currentWb), TEXT.PANEL_TITLE);
                    if (context.updateWorldInfoList) context.updateWorldInfoList();
                }
            }

            // 3. Auto Switch
            if (extension_settings[extensionName].autoSwitchPersona) {
                context.powerUserSettings.persona_selected = name;
                $("#your_name").val(name).trigger("input").trigger("change");
                $("#your_desc").val(desc).trigger("input").trigger("change");
            }

            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name), TEXT.PANEL_TITLE);
            $('.popup_close').click();

        } catch (e) {
            console.error(e);
            toastr.error("保存失败: " + e.message);
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-floppy-disk"></i> 保存并启用');
        }
    });

    // Clear
    $('#pw-clear').on('click', () => {
        if(confirm("确定清空当前所有内容？")) {
            $('input[type="text"], textarea').val('');
            $('#pw-result-area').hide();
            localStorage.removeItem(STORAGE_KEY_STATE);
        }
    });

    // View Switching
    const toggleView = (view) => {
        $('.pw-view').removeClass('active');
        $(`#pw-view-${view}`).addClass('active');
    };

    $('#pw-history').on('click', () => {
        const $list = $('#pw-history-list').empty();
        if (historyCache.length === 0) $list.html('<div style="text-align:center; opacity:0.5;">暂无记录</div>');
        
        historyCache.forEach(item => {
            const $el = $(`
                <div class="pw-history-item">
                    <div style="font-size:0.8em; opacity:0.5; margin-bottom:4px;">${item.timestamp}</div>
                    <div style="font-weight:bold; color:var(--SmartThemeQuoteColor); font-size:1.05em;">${item.data.name}</div>
                    <div style="font-size:0.9em; opacity:0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="opacity:0.6; border:1px solid var(--SmartThemeBorderColor); border-radius:3px; padding:0 3px; font-size:0.8em; margin-right:5px;">
                            ${item.format === 'paragraph' ? '小说段落' : '属性表'}
                        </span>
                        ${item.request}
                    </div>
                </div>
            `);
            $el.on('click', () => {
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                
                // Restore format selection
                currentFormat = item.format || 'list';
                $('.pw-fmt-opt').removeClass('active');
                $(`.pw-fmt-opt[data-fmt="${currentFormat}"]`).addClass('active');

                $('#pw-result-area').show();
                autoSave();
                toggleView('editor');
            });
            $list.append($el);
        });
        toggleView('history');
        $('#pw-clear').hide();
    });

    $('#pw-btn-back').on('click', () => {
        toggleView('editor');
        $('#pw-clear').show();
    });
}

// ============================================================================
// SETTINGS & INIT
// ============================================================================

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    $("#pw_auto_switch").prop("checked", extension_settings[extensionName].autoSwitchPersona);
    $("#pw_sync_wi").prop("checked", extension_settings[extensionName].syncToWorldInfo);
}

function onSettingChanged() {
    extension_settings[extensionName].autoSwitchPersona = $("#pw_auto_switch").prop("checked");
    extension_settings[extensionName].syncToWorldInfo = $("#pw_sync_wi").prop("checked");
    saveSettingsDebounced();
}

jQuery(async () => {
    injectStyles();
    await loadSettings();

    const settingsHtml = `
    <div class="world-info-cleanup-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${TEXT.PANEL_TITLE}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="margin: 10px 0;">
                    <input id="pw_open_btn" class="menu_button" type="button" 
                           value="${TEXT.BTN_OPEN_MAIN}" 
                           style="width: 100%; padding: 8px; font-weight: bold; background: var(--SmartThemeQuoteColor); color: #fff;" />
                    <small style="display: block; text-align: center; opacity: 0.7; margin-top: 5px;">
                        ${TEXT.BTN_OPEN_DESC}
                    </small>
                </div>
                <hr class="sysHR" />
                <div style="margin-bottom: 10px;">
                    <div class="flex-container" style="margin: 5px 0; align-items: center;">
                        <input id="pw_auto_switch" type="checkbox" />
                        <label for="pw_auto_switch" style="margin-left: 8px;">${TEXT.LABEL_AUTO_SWITCH}</label>
                    </div>
                    <div class="flex-container" style="margin: 5px 0; align-items: center;">
                        <input id="pw_sync_wi" type="checkbox" />
                        <label for="pw_sync_wi" style="margin-left: 8px;">${TEXT.LABEL_SYNC_WI}</label>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(settingsHtml);
    $("#pw_open_btn").on("click", openCreatorPopup);
    $("#pw_auto_switch").on("change", onSettingChanged);
    $("#pw_sync_wi").on("change", onSettingChanged);

    console.log(`${extensionName} loaded.`);
});
