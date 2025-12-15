import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v4';
const STORAGE_KEY_STATE = 'pw_state_v4'; 

// 默认标签库 (包含默认值结构)
const defaultTags = [
    { label: "姓名", value: "" },
    { label: "年龄", value: "" },
    { label: "性别", value: "" },
    { label: "种族", value: "" },
    { label: "职业", value: "" },
    { label: "阵营", value: "" },
    { label: "性格(MBTI)", value: "" },
    { label: "外貌", value: "" },
    { label: "说话风格", value: "" },
    { label: "特殊能力", value: "" },
    { label: "过往经历", value: "" },
    { label: "与主角关系", value: "" },
    { label: "XP/性癖", value: "" },
    { label: "弱点", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 10,
    outputFormat: 'yaml', // yaml | paragraph
    customTags: defaultTags, 
    // 独立API设置
    apiConfig: {
        useIndependent: false,
        source: 'openai', // 目前主要支持 openai 兼容格式
        url: "https://api.openai.com/v1",
        key: "",
        model: "gpt-3.5-turbo",
        temp: 0.7
    }
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro ✒️",
    BTN_OPEN_MAIN: "✨ 打开设定生成器",
    BTN_OPEN_DESC: "AI 辅助生成人设 | 独立API | 深度世界书集成",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_API_TEST_OK: "✅ API 连接成功！",
    TOAST_API_TEST_FAIL: "❌ API 连接失败，请检查 URL 和 Key",
    TOAST_SAVE_SUCCESS: (name) => `已保存并切换为: ${name}`,
    TOAST_WI_SUCCESS: (book) => `已更新世界书: ${book}`
};

// ============================================================================
// 2. 状态管理
// ============================================================================

let historyCache = [];
let worldInfoCache = {}; 
let allWorldNames = []; // 缓存所有世界书名

function loadHistory() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
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
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css-v4';
    if ($(`#${styleId}`).length) return;

    const css = `
    .pw-wrapper { display: flex; flex-direction: column; height: 100%; text-align: left; font-size: 0.95em; min-height: 600px; }
    
    /* Header */
    .pw-header { padding: 0; background: var(--SmartThemeBg); border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; }
    .pw-top-bar { padding: 12px; display: flex; justify-content: space-between; align-items: center; }
    .pw-title { font-weight: bold; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
    .pw-tools i { cursor: pointer; margin-left: 15px; opacity: 0.7; transition: 0.2s; font-size: 1.1em; }
    .pw-tools i:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }

    /* Tabs */
    .pw-tabs { display: flex; background: var(--black30a); }
    .pw-tab { flex: 1; text-align: center; padding: 10px; cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7; transition: 0.2s; font-size: 0.9em; font-weight: bold; }
    .pw-tab:hover { background: var(--white10a); opacity: 1; }
    .pw-tab.active { border-bottom-color: var(--SmartThemeQuoteColor); opacity: 1; color: var(--SmartThemeQuoteColor); background: var(--white10a); }

    /* Content View */
    .pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    .pw-view.active { display: flex; }
    .pw-scroll-area { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }

    /* Tags */
    .pw-tags-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; background: var(--black10a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); margin-bottom: 5px; }
    .pw-tag { padding: 4px 10px; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; font-size: 0.85em; transition: 0.2s; user-select: none; display: flex; align-items: center; gap: 5px;}
    .pw-tag:hover { border-color: var(--SmartThemeQuoteColor); transform: translateY(-1px); }
    .pw-tag i { font-size: 0.8em; opacity: 0.6; }
    
    .pw-tag-edit-row { display: flex; gap: 5px; margin-bottom: 5px; align-items: center; }
    .pw-tag-edit-input { flex: 1; padding: 5px; border-radius: 4px; border: 1px solid var(--SmartThemeBorderColor); background: var(--black10a); color: var(--SmartThemeBodyColor); }

    /* World Info */
    .pw-wi-toolbar { display: flex; gap: 10px; margin-bottom: 10px; }
    .pw-wi-select { flex: 1; padding: 6px; border-radius: 4px; background: var(--SmartThemeInputColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); }
    .pw-wi-book { border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; overflow: hidden; margin-bottom: 8px; background: var(--black10a); }
    .pw-wi-header { padding: 10px; background: var(--black30a); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 0.9em; }
    .pw-wi-list { display: none; padding: 5px; border-top: 1px solid var(--SmartThemeBorderColor); max-height: 300px; overflow-y: auto; }
    .pw-wi-item { padding: 6px 10px; border-bottom: 1px solid var(--white10a); font-size: 0.85em; }
    .pw-wi-item-top { display: flex; align-items: center; gap: 8px; }
    .pw-wi-detail { margin-top: 5px; padding: 5px; background: var(--black30a); border-radius: 4px; font-size: 0.85em; opacity: 0.8; display: none; white-space: pre-wrap; }
    
    /* API Config */
    .pw-api-group { border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; padding: 15px; background: var(--black10a); display: flex; flex-direction: column; gap: 12px; }
    .pw-form-row { display: flex; flex-direction: column; gap: 5px; }
    .pw-form-label { font-size: 0.85em; font-weight: bold; opacity: 0.8; }
    
    /* Buttons */
    .pw-btn { border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; color: white; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; }
    .pw-btn.gen { background: linear-gradient(90deg, var(--SmartThemeQuoteColor), var(--SmartThemeEmColor)); }
    .pw-btn.save { background: var(--SmartThemeEmColor); }
    .pw-btn.neutral { background: var(--grey50a); }
    .pw-btn:disabled { opacity: 0.6; filter: grayscale(1); cursor: not-allowed; }
    .pw-btn-sm { padding: 4px 10px; font-size: 0.85em; width: auto; display: inline-flex; }

    /* Inputs */
    .pw-textarea { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); border-radius: 6px; padding: 10px; resize: vertical; min-height: 120px; font-family: inherit; line-height: 1.5; }
    .pw-input { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 8px; border-radius: 4px; box-sizing: border-box; }
    
    /* Labels & Misc */
    .pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
    .pw-link { color: var(--SmartThemeQuoteColor); cursor: pointer; text-decoration: underline; font-size: 0.9em; }
    
    /* Animation */
    @keyframes pw-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .fa-spin { animation: pw-spin 1s linear infinite; }
    `;
    $('<style>').attr('id', styleId).html(css).appendTo('head');
}

// ============================================================================
// 3. 逻辑核心: 世界书 & API
// ============================================================================

// 获取所有世界书名字
async function refreshAllWorldNames() {
    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({}) });
        if (response.ok) {
            const data = await response.json();
            allWorldNames = data.map(i => i.name || i).sort();
        }
    } catch(e) { console.error(e); }
    return allWorldNames;
}

// 获取当前绑定的世界书列表 (默认)
async function getConnectedWorldBooks() {
    const context = getContext();
    const books = new Set();
    if (context.chatMetadata?.world_info) books.add(context.chatMetadata.world_info);
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        const mainWorld = data.extensions?.world || data.world || data.character_book?.name;
        if (mainWorld && typeof mainWorld === 'string') books.add(mainWorld);
    }
    if (context.worldInfoSettings?.globalSelect) {
        context.worldInfoSettings.globalSelect.forEach(b => books.add(b));
    }
    return Array.from(books).filter(Boolean);
}

// 独立 API 调用 (OpenAI Compatible)
async function callIndependentApi(prompt, systemPrompt) {
    const config = extension_settings[extensionName].apiConfig;
    if (!config.url || !config.key) throw new Error("API URL 或 Key 未配置");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s Timeout

    try {
        // 标准 OpenAI 格式
        let endpoint = config.url;
        if (!endpoint.endsWith('/v1')) {
            if (!endpoint.endsWith('/')) endpoint += '/';
            endpoint += 'v1';
        }
        if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions';

        const payload = {
            model: config.model || "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: parseFloat(config.temp) || 0.7,
            stream: false
        };

        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.key}`
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API Error ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return data.choices[0].message.content;

    } catch (e) {
        throw e;
    }
}

// 主生成函数
async function generatePersona(data) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    // 格式指令
    let formatInst = data.format === 'yaml' 
        ? `"description": "Create a detailed character sheet in standard YAML format. Include keys like Name, Age, Appearance, Personality, Background, etc."`
        : `"description": "Output as a narrative, descriptive paragraph in third person."`;

    // 迭代模式：如果有现有内容，作为参考
    let existingContext = "";
    if (data.existingContent && data.existingContent.length > 10) {
        existingContext = `\n[EXISTING DRAFT (For Reference/Modification)]:\n${data.existingContent}\n\nINSTRUCTION: Refine and modify the draft above based on the new requirements below. Keep unchanged parts consistent.`;
    }

    // 世界书上下文
    let wiContext = "";
    if (data.selectedWiContext && data.selectedWiContext.length > 0) {
        wiContext = `\n[World Info / Lore Reference]:\n${data.selectedWiContext.join('\n')}\n`;
    }

    const systemPrompt = `You are a professional creative writing assistant specializing in character creation.
Output strictly valid JSON. No markdown code blocks.`;

    const userPrompt = `
Task: Create or Refine a User Persona.
Current Character: ${char.name}
Scenario: ${char.scenario || "None"}
${wiContext}
${existingContext}

[User Requirements]:
${data.request}

Return ONLY a JSON object:
{
    "name": "Name",
    ${formatInst},
    "wi_entry": "Background facts about this persona for World Info (summary)."
}`;

    let resultText = "";

    // 选择调用方式
    if (data.useIndependentApi) {
        console.log("[PW] Using Independent API");
        resultText = await callIndependentApi(userPrompt, systemPrompt);
    } else {
        console.log("[PW] Using Main API (Quiet Prompt)");
        // 使用 ST 内置生成
        resultText = await context.generateQuietPrompt(userPrompt, false, false, "System");
    }

    // 解析 JSON
    try {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid JSON format from AI");
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.warn("Raw Output:", resultText);
        throw e;
    }
}

// ============================================================================
// 4. UI 构建
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) return toastr.warning(TEXT.TOAST_NO_CHAR);

    loadHistory();
    await refreshAllWorldNames();
    const savedState = loadState();
    
    // 初始化默认绑定书 (Set 转 Array)
    const boundBooks = await getConnectedWorldBooks();
    // 状态中保存的已选书列表，如果为空则使用绑定书
    const activeBooks = (savedState.activeBooks && savedState.activeBooks.length) ? savedState.activeBooks : boundBooks;

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-top-bar">
                <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定编织者 Pro</div>
                <div class="pw-tools">
                    <i class="fa-solid fa-eraser" id="pw-clear" title="清空并重置"></i>
                    <i class="fa-solid fa-save" id="pw-force-save" title="保存当前状态"></i>
                </div>
            </div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-view="editor"><i class="fa-solid fa-pen-nib"></i> 编辑</div>
                <div class="pw-tab" data-view="context"><i class="fa-solid fa-book-atlas"></i> 世界书</div>
                <div class="pw-tab" data-view="settings"><i class="fa-solid fa-sliders"></i> API</div>
                <div class="pw-tab" data-view="history"><i class="fa-solid fa-clock-rotate-left"></i> 历史</div>
            </div>
        </div>

        <!-- 1. 编辑视图 -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                
                <!-- 标签栏 -->
                <div>
                    <div class="pw-label">
                        <span>点击标签</span>
                        <span class="pw-link" id="pw-manage-tags"><i class="fa-solid fa-cog"></i> 管理标签</span>
                    </div>
                    <div class="pw-tags-container" id="pw-tags-area">
                        <!-- JS 填充 -->
                    </div>
                </div>

                <!-- 混合输入框 -->
                <div>
                    <div class="pw-label">混合输入区：点击标签或自由编写</div>
                    <textarea id="pw-request" class="pw-textarea" placeholder="例：我是他的宿敌... (点击上方标签可插入预设信息)">${savedState.request || ''}</textarea>
                </div>

                <!-- 格式与生成 -->
                <div style="display:flex; gap:10px; align-items:center; margin-top:5px;">
                    <select id="pw-fmt-select" class="pw-input" style="flex:1;">
                        <option value="yaml" ${savedState.format === 'yaml' ? 'selected' : ''}>📄 YAML 属性表 (推荐)</option>
                        <option value="paragraph" ${savedState.format === 'paragraph' ? 'selected' : ''}>📝 小说段落</option>
                    </select>
                    <button id="pw-btn-gen" class="pw-btn gen" style="flex:2;"><i class="fa-solid fa-bolt"></i> 生成 / 二次润色</button>
                </div>

                <!-- 结果区域 -->
                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 15px;">
                    <div class="pw-label" style="color:var(--SmartThemeQuoteColor);"><i class="fa-solid fa-check-circle"></i> 生成结果 (可手动修改)</div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="角色名称" value="${savedState.name || ''}">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="8" placeholder="详细设定">${savedState.desc || ''}</textarea>
                        
                        <div style="background:var(--black10a); padding:10px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor);">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <input type="checkbox" id="pw-wi-toggle" checked>
                                    <span style="font-size:0.9em; font-weight:bold;">同步写入世界书</span>
                                </div>
                                <select id="pw-wi-target-select" class="pw-input" style="padding:2px; font-size:0.8em; width:150px;">
                                    <!-- JS 填充目标书 -->
                                </select>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目内容...">${savedState.wiContent || ''}</textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save" style="margin-top:10px;"><i class="fa-solid fa-check"></i> 保存并启用</button>
                </div>
            </div>
        </div>

        <!-- 2. 世界书视图 -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-wi-toolbar">
                    <select id="pw-wi-add-select" class="pw-wi-select">
                        <option value="">-- 添加更多世界书 --</option>
                        <!-- JS 填充所有书名 -->
                    </select>
                    <button id="pw-btn-add-book" class="pw-btn pw-btn-sm gen"><i class="fa-solid fa-plus"></i> 添加</button>
                </div>
                <div id="pw-wi-books-list">
                    <!-- JS 填充已选书 -->
                </div>
            </div>
        </div>

        <!-- 3. API 设置 -->
        <div id="pw-view-settings" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-api-group">
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span style="font-weight:bold;">启用独立 API</span>
                        <input type="checkbox" id="pw-api-use" style="transform:scale(1.2);">
                    </div>
                    <div class="pw-form-row">
                        <span class="pw-form-label">API URL (Base URL)</span>
                        <input type="text" id="pw-api-url" class="pw-input" placeholder="https://api.openai.com/v1">
                    </div>
                    <div class="pw-form-row">
                        <span class="pw-form-label">API Key</span>
                        <input type="password" id="pw-api-key" class="pw-input" placeholder="sk-...">
                    </div>
                    <div style="display:flex; gap:10px;">
                        <div class="pw-form-row" style="flex:1;">
                            <span class="pw-form-label">Model ID</span>
                            <input type="text" id="pw-api-model" class="pw-input" placeholder="gpt-3.5-turbo">
                        </div>
                        <div class="pw-form-row" style="width:80px;">
                            <span class="pw-form-label">Temp</span>
                            <input type="number" id="pw-api-temp" class="pw-input" step="0.1" min="0" max="2">
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:5px;">
                        <button id="pw-api-test" class="pw-btn neutral"><i class="fa-solid fa-plug"></i> 测试连接</button>
                        <button id="pw-api-fetch-models" class="pw-btn neutral"><i class="fa-solid fa-list"></i> 获取模型列表</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. 历史 -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area" id="pw-history-list"></div>
        </div>
    </div>
    `;

    // 打开弹窗
    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // ========================================================================
    // 逻辑绑定
    // ========================================================================
    
    // 初始化 UI 数据
    const initUI = () => {
        // 1. 渲染标签
        renderTags();
        
        // 2. 渲染世界书添加列表
        const $addSelect = $('#pw-wi-add-select');
        allWorldNames.forEach(name => {
            if (!activeBooks.includes(name)) {
                $addSelect.append(`<option value="${name}">${name}</option>`);
            }
        });

        // 3. 渲染已选世界书区域
        renderActiveBooks();

        // 4. 填充 API 设置
        const apiCfg = extension_settings[extensionName].apiConfig;
        $('#pw-api-use').prop('checked', apiCfg.useIndependent);
        $('#pw-api-url').val(apiCfg.url);
        $('#pw-api-key').val(apiCfg.key);
        $('#pw-api-model').val(apiCfg.model);
        $('#pw-api-temp').val(apiCfg.temp);
    };

    // --- 标签系统 ---
    const renderTags = () => {
        const $area = $('#pw-tags-area').empty();
        const tags = extension_settings[extensionName].customTags;
        tags.forEach(t => {
            // 如果有值，显示 (值)，否则只显示标签名
            const display = t.value ? `${t.label} (${t.value})` : t.label;
            const $tag = $(`<div class="pw-tag" data-label="${t.label}" data-val="${t.value}"><i class="fa-solid fa-plus"></i> ${display}</div>`);
            $tag.on('click', function() {
                const $req = $('#pw-request');
                const cur = $req.val();
                const insert = $(this).data('val') ? `${$(this).data('label')}：${$(this).data('val')}` : `${$(this).data('label')}：`;
                $req.val(cur ? cur + '\n' + insert : insert).focus();
                // Scroll bottom
                $req[0].scrollTop = $req[0].scrollHeight;
                saveCurrentState();
            });
            $area.append($tag);
        });
    };

    $('#pw-manage-tags').on('click', async () => {
        // 简易标签管理弹窗
        const tags = extension_settings[extensionName].customTags;
        let rowsHtml = tags.map((t, i) => `
            <div class="pw-tag-edit-row">
                <input type="text" class="pw-tag-edit-input tag-lbl" value="${t.label}" placeholder="标签名">
                <input type="text" class="pw-tag-edit-input tag-val" value="${t.value}" placeholder="默认值(可选)">
                <i class="fa-solid fa-trash" style="cursor:pointer; color:var(--SmartThemeColorRed);" onclick="$(this).parent().remove()"></i>
            </div>
        `).join('');
        
        const html = `
            <div style="padding:10px;">
                <div id="pw-tags-list-edit">${rowsHtml}</div>
                <button class="pw-btn neutral" id="pw-add-tag-row" style="margin-top:10px;"><i class="fa-solid fa-plus"></i> 新增一行</button>
            </div>
        `;
        
        const confirmed = await callPopup(html, 'confirm', '', { okButton: "保存" });
        if (confirmed) {
            const newTags = [];
            $('#pw-tags-list-edit .pw-tag-edit-row').each(function() {
                const l = $(this).find('.tag-lbl').val().trim();
                const v = $(this).find('.tag-val').val().trim();
                if (l) newTags.push({ label: l, value: v });
            });
            extension_settings[extensionName].customTags = newTags;
            saveSettingsDebounced();
            renderTags();
        }
    });
    
    // jQuery 动态绑定新增标签行
    $(document).on('click', '#pw-add-tag-row', function() {
        $('#pw-tags-list-edit').append(`
            <div class="pw-tag-edit-row">
                <input type="text" class="pw-tag-edit-input tag-lbl" placeholder="标签名">
                <input type="text" class="pw-tag-edit-input tag-val" placeholder="默认值(可选)">
                <i class="fa-solid fa-trash" style="cursor:pointer; color:var(--SmartThemeColorRed);" onclick="$(this).parent().remove()"></i>
            </div>
        `);
    });

    // --- 世界书管理 ---
    const renderActiveBooks = async () => {
        const $list = $('#pw-wi-books-list').empty();
        const $targetSelect = $('#pw-wi-target-select').empty(); // 同时更新结果区的下拉框

        for (const book of activeBooks) {
            $targetSelect.append(`<option value="${book}">${book}</option>`);

            const $el = $(`
                <div class="pw-wi-book">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book}</span>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <i class="fa-solid fa-times" style="font-size:0.8em; opacity:0.5;" title="移除 (不删除文件)" data-remove="${book}"></i>
                            <i class="fa-solid fa-chevron-down arrow"></i>
                        </div>
                    </div>
                    <div class="pw-wi-list">
                        <div style="text-align:center; padding:10px;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                    </div>
                </div>
            `);

            // 移除按钮
            $el.find('.fa-times').on('click', (e) => {
                e.stopPropagation();
                const idx = activeBooks.indexOf(book);
                if (idx > -1) {
                    activeBooks.splice(idx, 1);
                    renderActiveBooks();
                    saveCurrentState(); // 保存已选书单状态
                }
            });

            // 展开加载
            $el.find('.pw-wi-header').on('click', async function() {
                const $content = $el.find('.pw-wi-list');
                const $arrow = $(this).find('.arrow');
                
                if ($content.is(':visible')) {
                    $content.slideUp();
                    $arrow.removeClass('fa-flip-vertical');
                } else {
                    $content.slideDown();
                    $arrow.addClass('fa-flip-vertical');
                    
                    if (!$content.data('loaded')) {
                        try {
                            const headers = getRequestHeaders();
                            const res = await fetch('/api/worldinfo/get', { 
                                method: 'POST', headers, body: JSON.stringify({ name: book }) 
                            });
                            const data = await res.json();
                            const entries = Object.values(data.entries || {});
                            $content.empty();
                            
                            if (entries.length === 0) $content.html('<div style="padding:10px; text-align:center; opacity:0.5;">无条目</div>');
                            
                            entries.forEach(entry => {
                                const key = Array.isArray(entry.key) ? entry.key.join(', ') : entry.key;
                                const content = entry.content;
                                const isEnabled = entry.enabled ? 'checked' : '';
                                
                                const $item = $(`
                                    <div class="pw-wi-item">
                                        <div class="pw-wi-item-top">
                                            <input type="checkbox" class="pw-wi-check" ${isEnabled} data-content="${encodeURIComponent(content)}">
                                            <span style="font-weight:bold; flex:1; cursor:pointer;" class="pw-toggle-detail">${key}</span>
                                            <i class="fa-solid fa-eye pw-toggle-detail" style="cursor:pointer; opacity:0.5;"></i>
                                        </div>
                                        <div class="pw-wi-detail">${content}</div>
                                    </div>
                                `);
                                
                                // 展开详情
                                $item.find('.pw-toggle-detail').on('click', () => {
                                    $item.find('.pw-wi-detail').slideToggle();
                                });
                                $content.append($item);
                            });
                            $content.data('loaded', true);
                        } catch(e) {
                            $content.html(`<div style="padding:10px; color:red;">加载失败</div>`);
                        }
                    }
                }
            });
            $list.append($el);
        }
    };

    // 添加新书
    $('#pw-btn-add-book').on('click', () => {
        const val = $('#pw-wi-add-select').val();
        if (val && !activeBooks.includes(val)) {
            activeBooks.push(val);
            renderActiveBooks();
            saveCurrentState();
        }
    });

    // --- API 设置 ---
    const saveApiConfig = () => {
        const cfg = extension_settings[extensionName].apiConfig;
        cfg.useIndependent = $('#pw-api-use').is(':checked');
        cfg.url = $('#pw-api-url').val();
        cfg.key = $('#pw-api-key').val();
        cfg.model = $('#pw-api-model').val();
        cfg.temp = $('#pw-api-temp').val();
        saveSettingsDebounced();
    };
    $('#pw-view-settings input').on('change', saveApiConfig);

    $('#pw-api-test').on('click', async function() {
        const $btn = $(this); $btn.prop('disabled', true);
        saveApiConfig();
        const cfg = extension_settings[extensionName].apiConfig;
        try {
            // Simple model list fetch
            let endpoint = cfg.url;
            if (!endpoint.endsWith('/v1')) endpoint = endpoint.replace(/\/$/, '') + '/v1';
            endpoint += '/models';
            
            const res = await fetch(endpoint, {
                headers: { "Authorization": `Bearer ${cfg.key}` }
            });
            if (res.ok) toastr.success(TEXT.TOAST_API_TEST_OK);
            else throw new Error(res.statusText);
        } catch(e) {
            toastr.error(TEXT.TOAST_API_TEST_FAIL + ": " + e.message);
        } finally {
            $btn.prop('disabled', false);
        }
    });

    // --- 核心生成逻辑 ---
    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            format: $('#pw-fmt-select').val(),
            hasResult: $('#pw-result-area').is(':visible'),
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val(),
            activeBooks: activeBooks // 保存当前选择的书单
        });
    };
    $(document).on('input change.pw', '#pw-request, #pw-res-name, #pw-res-desc, #pw-res-wi', saveCurrentState);

    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        if (!req.trim()) return toastr.warning("请输入内容");

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 思考中...');

        // 收集世界书上下文
        const selectedWiContext = [];
        $('.pw-wi-check:checked').each(function() {
            selectedWiContext.push(decodeURIComponent($(this).data('content')));
        });

        const params = {
            request: req,
            format: $('#pw-fmt-select').val(),
            existingContent: $('#pw-res-desc').val(), // 传入现有内容进行迭代
            selectedWiContext: selectedWiContext,
            useIndependentApi: $('#pw-api-use').is(':checked')
        };

        try {
            const data = await generatePersona(params);
            
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            saveHistory({ request: req, data });
            saveCurrentState();
        } catch (e) {
            console.error(e);
            toastr.error("生成失败: " + e.message);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // 保存并启用
    $('#pw-btn-apply').on('click', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        const targetBook = $('#pw-wi-target-select').val();

        if (!name) return toastr.warning("名字不能为空");

        const $btn = $(this); $btn.prop('disabled', true);

        try {
            const context = getContext();
            if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
            context.powerUserSettings.personas[name] = desc;
            await saveSettingsDebounced();

            // 写入世界书
            if ($('#pw-wi-toggle').is(':checked') && wiContent && targetBook) {
                const headers = getRequestHeaders();
                const getRes = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: targetBook }) });
                if (getRes.ok) {
                    const bookData = await getRes.json();
                    if (!bookData.entries) bookData.entries = {};
                    const ids = Object.keys(bookData.entries).map(Number);
                    const newId = ids.length ? Math.max(...ids) + 1 : 0;
                    bookData.entries[newId] = {
                        uid: newId, key: [name, "User"], content: wiContent,
                        comment: `[User] ${name}`, enabled: true, selective: true
                    };
                    await fetch('/api/worldinfo/edit', { method: 'POST', headers, body: JSON.stringify({ name: targetBook, data: bookData }) });
                    toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
                    if (context.updateWorldInfoList) context.updateWorldInfoList();
                }
            }

            if (extension_settings[extensionName].autoSwitchPersona) {
                context.powerUserSettings.persona_selected = name;
                $("#your_name").val(name).trigger("input").trigger("change");
                $("#your_desc").val(desc).trigger("input").trigger("change");
            }
            toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
            $('.popup_close').click();
        } catch(e) {
            toastr.error("保存失败");
        } finally {
            $btn.prop('disabled', false);
        }
    });

    // 顶部按钮
    $('#pw-clear').on('click', () => {
        if(confirm("确定清空？")) {
            $('#pw-request').val('');
            $('#pw-res-name').val('');
            $('#pw-res-desc').val('');
            $('#pw-res-wi').val('');
            $('#pw-result-area').hide();
            saveCurrentState();
        }
    });
    $('#pw-force-save').on('click', () => { saveCurrentState(); toastr.success("状态已保存"); });

    // Tab 切换
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        $(`#pw-view-${$(this).data('view')}`).addClass('active');
    });

    // 初始化运行
    initUI();
}

// ============================================================================
// 初始化入口
// ============================================================================

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    // Deep merge defaults
    const merged = { ...defaultSettings, ...extension_settings[extensionName] };
    // Ensure nested objects exist
    if (!merged.apiConfig) merged.apiConfig = defaultSettings.apiConfig;
    if (!merged.customTags) merged.customTags = defaultSettings.customTags;
    extension_settings[extensionName] = merged;
}

jQuery(async () => {
    injectStyles();
    await loadSettings();

    // 扩展栏按钮
    const btnHtml = `
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
                    <small style="display: block; text-align: center; opacity: 0.7; margin-top: 5px;">${TEXT.BTN_OPEN_DESC}</small>
                </div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(btnHtml);
    $("#pw_open_btn").on("click", openCreatorPopup);
    console.log(`${extensionName} v4 loaded.`);
});
