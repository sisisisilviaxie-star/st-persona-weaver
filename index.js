
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v8'; // 升级版本号，确保数据结构兼容
const STORAGE_KEY_STATE = 'pw_state_v8'; 
const STORAGE_KEY_TAGS = 'pw_tags_v3';

// 默认标签库
const defaultTags = [
    { name: "姓名", value: "" },
    { name: "性别", value: "" },
    { name: "年龄", value: "" },
    { name: "MBTI", value: "" },
    { name: "职业", value: "" },
    { name: "阵营", value: "" },
    { name: "外貌", value: "" },
    { name: "性格", value: "" },
    { name: "关系", value: "" },
    { name: "XP/性癖", value: "" },
    { name: "秘密", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 50, // 增加历史记录上限
    outputFormat: 'yaml', 
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_OPEN_MAIN: "打开设定生成器",
    LABEL_TAGS: "点击插入标签",
    TOAST_NO_CHAR: "请先打开一个角色聊天",
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `设定已保存并切换为: ${name}`
};

// ============================================================================
// 2. 状态与存储
// ============================================================================

let historyCache = [];
let tagsCache = [];
let worldInfoCache = {}; 
let availableWorldBooks = []; 

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

// [修改] 增强的保存历史逻辑
function saveHistory(item) {
    // 获取当前对话的角色名作为元数据
    const context = getContext();
    const charName = context.characters[context.characterId]?.name || "未知角色";
    
    item.timestamp = new Date().toLocaleString();
    item.targetChar = charName; // 记录是为哪个角色生成的

    // 如果没有名字，尝试从请求中截取
    if (!item.data.name) {
        item.data.name = item.request.length > 15 ? item.request.substring(0, 15) + "..." : item.request;
    }
    if (!item.data.name) item.data.name = "未命名设定";

    historyCache.unshift(item);
    
    // 限制长度
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    if (historyCache.length > limit) {
        historyCache = historyCache.slice(0, limit);
    }
    saveData();
}

function saveState(data) {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
}

function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; }
}

function injectStyles() {
    const styleId = 'persona-weaver-css-v8';
    if ($(`#${styleId}`).length) return;

    const css = `
    .pw-wrapper { display: flex; flex-direction: column; height: 100%; text-align: left; font-size: 0.95em; min-height: 600px; position: relative; overflow: hidden; }
    
    /* Header */
    .pw-header { background: var(--SmartThemeBg); border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; flex-shrink: 0; }
    .pw-top-bar { padding: 12px 15px; display: flex; justify-content: space-between; align-items: center; }
    .pw-title { font-weight: bold; font-size: 1.1em; display: flex; align-items: center; gap: 8px; }
    
    /* Tabs */
    .pw-tabs { display: flex; background: var(--black30a); user-select: none; }
    .pw-tab { flex: 1; text-align: center; padding: 10px; cursor: pointer; border-bottom: 3px solid transparent; opacity: 0.7; font-size: 0.9em; font-weight: bold; transition: 0.2s; }
    .pw-tab:hover { background: var(--white10a); opacity: 1; }
    .pw-tab.active { border-bottom-color: var(--SmartThemeQuoteColor); opacity: 1; color: var(--SmartThemeQuoteColor); background: var(--white05a); }

    /* Scroll Area */
    .pw-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    .pw-view.active { display: flex; }
    .pw-scroll-area { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }

    /* Tags System */
    .pw-tags-wrapper { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 5px; }
    .pw-tags-container { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: var(--black10a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); max-height: 120px; overflow-y: auto; }
    .pw-tag { padding: 4px 10px; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; font-size: 0.85em; user-select: none; transition: 0.1s; }
    .pw-tag:hover { border-color: var(--SmartThemeQuoteColor); color: var(--SmartThemeQuoteColor); transform: translateY(-1px); }
    .pw-tag-val { opacity: 0.6; font-size: 0.9em; margin-left: 2px; }
    .pw-tags-edit-btn { padding: 8px; cursor: pointer; opacity: 0.7; font-size: 1.1em; }
    .pw-tags-edit-btn:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }

    /* [重要修复] Tag Manager Modal (Overlay) */
    .pw-modal-overlay { 
        position: absolute; 
        top: 0; 
        left: 0; 
        right: 0;
        bottom: 0;
        width: 100%; 
        height: 100%; 
        /* 强制不透明背景，防止透视 */
        background-color: var(--SmartThemeBg) !important; 
        /* 添加一个深色遮罩以防主题本身是透明的 */
        background-image: linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8));
        backdrop-filter: blur(10px); /* 模糊背景，增加层次感 */
        z-index: 2000; /* 极高层级 */
        display: none; 
        flex-direction: column; 
    }
    .pw-modal-header { padding: 15px; border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 1.1em; background: var(--black30a); }
    .pw-modal-body { flex: 1; overflow-y: auto; padding: 15px; }
    
    .pw-tag-row { 
        display: flex; 
        gap: 8px; 
        margin-bottom: 8px; 
        align-items: center; 
        background: var(--black10a); 
        padding: 8px; 
        border-radius: 4px; 
        border: 1px solid var(--SmartThemeBorderColor);
    }
    
    /* History Search Bar */
    .pw-history-toolbar { display: flex; gap: 10px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor); }
    .pw-history-search { flex: 1; padding: 8px; border-radius: 4px; border: 1px solid var(--SmartThemeBorderColor); background: var(--SmartThemeInputColor); color: var(--SmartThemeBodyColor); }
    
    .pw-history-item { 
        padding: 12px; 
        border: 1px solid var(--SmartThemeBorderColor);
        border-radius: 6px;
        background: var(--black10a);
        cursor: pointer; 
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: 0.1s;
    }
    .pw-history-item:hover { background: var(--white10a); border-color: var(--SmartThemeQuoteColor); }
    .pw-hist-content { flex: 1; overflow: hidden; }
    .pw-hist-title { font-weight: bold; color: var(--SmartThemeQuoteColor); margin-bottom: 4px; }
    .pw-hist-meta { font-size: 0.8em; opacity: 0.6; margin-bottom: 4px; display: flex; gap: 10px; }
    .pw-hist-desc { font-size: 0.85em; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pw-hist-del { padding: 8px 12px; color: #ff6b6b; cursor: pointer; font-size: 1.1em; opacity: 0.7; transition: 0.2s; }
    .pw-hist-del:hover { opacity: 1; transform: scale(1.1); }

    /* API Settings */
    .pw-api-card { padding: 15px; background: var(--black10a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; gap: 12px; }
    .pw-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pw-row label { font-weight: bold; font-size: 0.9em; width: 80px; }
    
    /* Common */
    .pw-textarea { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); border-radius: 6px; padding: 10px; resize: vertical; min-height: 120px; font-family: inherit; line-height: 1.5; }
    .pw-textarea:focus { outline: 1px solid var(--SmartThemeQuoteColor); }
    .pw-input { width: 100%; background: var(--SmartThemeInputColor); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 8px; border-radius: 4px; }
    
    .pw-btn { border: none; padding: 10px; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: 0.2s; white-space: nowrap; }
    .pw-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .pw-btn:active { transform: translateY(1px); }
    .pw-btn.gen { background: linear-gradient(90deg, var(--SmartThemeQuoteColor), var(--SmartThemeEmColor)); width: 100%; font-size: 1em; padding: 12px; margin-top: 10px; }
    .pw-btn.save { background: var(--SmartThemeEmColor); width: 100%; }
    .pw-btn.normal { background: var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 6px 12px; }
    .pw-btn.primary { background: var(--SmartThemeQuoteColor); padding: 6px 12px; }
    .pw-mini-btn { font-size: 0.85em; cursor: pointer; opacity: 0.7; display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; user-select: none; }
    .pw-mini-btn:hover { opacity: 1; background: var(--white10a); border-color: var(--white10a); }

    .pw-label { font-size: 0.85em; opacity: 0.8; font-weight: bold; margin-bottom: 4px; display: block; }
    
    /* World Info Tree */
    .pw-wi-controls { display: flex; gap: 10px; margin-bottom: 10px; }
    .pw-wi-book { border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; overflow: hidden; margin-bottom: 8px; background: var(--black10a); }
    .pw-wi-header { padding: 10px 12px; background: var(--black30a); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 0.9em; }
    .pw-wi-header:hover { background: var(--white10a); }
    .pw-wi-list { display: none; padding: 0; border-top: 1px solid var(--SmartThemeBorderColor); max-height: 400px; overflow-y: auto; }
    .pw-wi-item { padding: 8px 12px; border-bottom: 1px solid var(--white05a); font-size: 0.85em; display: flex; flex-direction: column; gap: 4px; }
    .pw-wi-item-top { display: flex; align-items: center; gap: 8px; }
    .pw-wi-content { font-size: 0.9em; opacity: 0.8; padding: 8px; background: var(--black10a); border-radius: 4px; margin-top: 4px; display: none; white-space: pre-wrap; }
    .pw-wi-content.show { display: block; }
    .pw-expand-btn { cursor: pointer; opacity: 0.5; padding: 2px 6px; }
    .pw-expand-btn:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }
    `;
    $('<style>').attr('id', styleId).html(css).appendTo('head');
}

// ============================================================================
// 3. 业务逻辑 (世界书与生成)
// ============================================================================

async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    const context = getContext();
    
    if (window.TavernHelper && typeof window.TavernHelper.getWorldbookNames === 'function') {
        try { availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch (e) { console.warn("[PW] TavernHelper load failed", e); }
    }

    if (!availableWorldBooks || availableWorldBooks.length === 0) {
        try {
            const response = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    availableWorldBooks = data.map(item => item.name || item);
                } else if (data && data.world_names) {
                    availableWorldBooks = data.world_names;
                }
            }
        } catch (e) { console.error("[PW] API load failed", e); }
    }

    if (availableWorldBooks.length === 0) {
         if (context.world_names && Array.isArray(context.world_names)) {
            availableWorldBooks = [...context.world_names];
        } else if (window.world_names && Array.isArray(window.world_names)) {
            availableWorldBooks = [...window.world_names];
        }
    }
    
    availableWorldBooks = [...new Set(availableWorldBooks)].filter(x => x).sort();
}

async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras); 

    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        const main = data.extensions?.world || data.world || data.character_book?.name;
        if (main) books.add(main);
    }
    
    if (context.worldInfoSettings?.globalSelect) {
        context.worldInfoSettings.globalSelect.forEach(b => books.add(b));
    }

    return Array.from(books).filter(Boolean);
}

async function getWorldBookEntries(bookName) {
    if (worldInfoCache[bookName]) return worldInfoCache[bookName];
    try {
        const headers = getRequestHeaders();
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: bookName }) });
        if (response.ok) {
            const data = await response.json();
            const entries = Object.values(data.entries || {}).map(e => ({
                uid: e.uid,
                displayName: e.comment && e.comment.trim() !== "" ? e.comment : (Array.isArray(e.key) ? e.key.join(', ') : e.key),
                keys: Array.isArray(e.key) ? e.key.join(', ') : e.key,
                content: e.content,
                enabled: !e.disable && e.enabled !== false
            }));
            worldInfoCache[bookName] = entries;
            return entries;
        }
    } catch {}
    return [];
}

async function fetchModels(url, key) {
    try {
        const endpoint = url.includes('v1') ? `${url.replace(/\/$/, '')}/models` : `${url.replace(/\/$/, '')}/v1/models`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key}` }
        });
        if (!response.ok) throw new Error("Fetch failed");
        const data = await response.json();
        return (data.data || data).map(m => m.id).sort();
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const char = context.characters[context.characterId];
    
    const formatInst = data.format === 'yaml' 
        ? `"description": "Use YAML format key-value pairs inside this string. Keys: Name, Age, Role, Appearance, Personality, Background, etc."`
        : `"description": "Narrative paragraph style (Novel style, 3rd person). Approx 200 words."`;

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context/World Info]:\n${data.wiContext.join('\n\n')}\n`;
    }

    const systemPrompt = `You are a creative writing assistant.
Task: Create a detailed User Persona based on the Request.
${wiText}
Target Character: ${char.name}
Scenario: ${char.scenario || "None"}

[User Request]:
${data.request}

[Response Format]:
Return ONLY a JSON object:
{
    "name": "Name",
    "description": ${formatInst},
    "wi_entry": "Concise facts for World Info."
}`;

    if (apiConfig.apiSource === 'independent') {
        const url = `${apiConfig.indepApiUrl.replace(/\/$/, '')}/chat/completions`;
        const body = {
            model: apiConfig.indepApiModel,
            messages: [{ role: 'system', content: systemPrompt }],
            temperature: 0.7
        };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error("Independent API Error");
        const json = await res.json();
        const content = json.choices[0].message.content;
        return JSON.parse(content.match(/\{[\s\S]*\}/)[0]);
    } else {
        const generatedText = await context.generateQuietPrompt(systemPrompt, false, false, "System");
        return JSON.parse(generatedText.match(/\{[\s\S]*\}/)[0]);
    }
}

// ============================================================================
// 4. UI 渲染与交互
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    if (context.characterId === undefined) {
        return toastr.warning(TEXT.TOAST_NO_CHAR);
    }

    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };
    
    const renderTags = () => tagsCache.map((t, i) => `
        <div class="pw-tag" data-idx="${i}">
            <i class="fa-solid fa-tag" style="opacity:0.5;font-size:0.8em;"></i> ${t.name}
            ${t.value ? `<span class="pw-tag-val">:${t.value}</span>` : ''}
        </div>
    `).join('');

    const wiOptions = availableWorldBooks.length > 0 
        ? availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('')
        : `<option disabled>未找到世界书 (请检查是否已创建)</option>`;

    const html = `
    <div class="pw-wrapper">
        <div class="pw-header">
            <div class="pw-top-bar">
                <div class="pw-title"><i class="fa-solid fa-wand-magic-sparkles"></i> 设定编织者 Pro</div>
            </div>
            <div class="pw-tabs">
                <div class="pw-tab active" data-tab="editor">📝 编辑</div>
                <div class="pw-tab" data-tab="context">📚 世界书</div>
                <div class="pw-tab" data-tab="api">⚙️ API</div>
                <div class="pw-tab" data-tab="history">📜 历史</div>
            </div>
        </div>

        <!-- [修复] Tag Manager Modal (Overlay) -->
        <div id="pw-tag-modal" class="pw-modal-overlay">
            <div class="pw-modal-header">
                <span><i class="fa-solid fa-tags"></i> 管理标签</span>
                <i class="fa-solid fa-times" id="pw-tags-close" style="cursor:pointer;"></i>
            </div>
            <div class="pw-modal-body" id="pw-tags-edit-list"></div>
            <div style="padding:15px; border-top:1px solid var(--SmartThemeBorderColor); display:flex; gap:10px; background: var(--black30a);">
                <button id="pw-tags-add-new" class="pw-btn normal" style="flex:1;"><i class="fa-solid fa-plus"></i> 添加新标签</button>
                <button id="pw-tags-finish" class="pw-btn primary" style="flex:1;">完成</button>
            </div>
        </div>

        <!-- 1. 编辑视图 -->
        <div id="pw-view-editor" class="pw-view active">
            <div class="pw-scroll-area">
                <div>
                    <div class="pw-label" style="display:flex; justify-content:space-between;">
                        <span>${TEXT.LABEL_TAGS}</span>
                        <i class="fa-solid fa-gear pw-tags-edit-btn" title="管理标签"></i>
                    </div>
                    <div class="pw-tags-wrapper">
                        <div class="pw-tags-container" id="pw-tags-list">
                            ${renderTags()}
                        </div>
                    </div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column;">
                    <textarea id="pw-request" class="pw-textarea" placeholder="在此输入要求，或点击上方标签..." style="flex:1;">${savedState.request || ''}</textarea>
                    
                    <div class="pw-editor-controls">
                        <div style="display:flex; gap:10px;">
                            <div class="pw-mini-btn" id="pw-clear"><i class="fa-solid fa-eraser"></i> 清空</div>
                            <div class="pw-mini-btn" id="pw-snapshot"><i class="fa-solid fa-save"></i> 存入历史</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="font-size:0.85em; opacity:0.7;">格式:</span>
                            <select id="pw-fmt-select" class="pw-input" style="padding:2px 6px;">
                                <option value="yaml" ${config.outputFormat === 'yaml' ? 'selected' : ''}>YAML 属性表</option>
                                <option value="paragraph" ${config.outputFormat === 'paragraph' ? 'selected' : ''}>小说段落</option>
                            </select>
                        </div>
                    </div>
                </div>

                <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid fa-bolt"></i> 生成 / 润色</button>

                <div id="pw-result-area" style="display: ${savedState.hasResult ? 'block' : 'none'}; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 10px;">
                    <div class="pw-label" style="color:var(--SmartThemeQuoteColor);">
                        <i class="fa-solid fa-check-circle"></i> 生成结果 (可编辑)
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="pw-res-name" class="pw-input" placeholder="角色名称" value="${savedState.name || ''}">
                        <textarea id="pw-res-desc" class="pw-textarea" rows="8" placeholder="用户设定描述">${savedState.desc || ''}</textarea>
                        
                        <div style="background:var(--black10a); padding:8px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor);">
                            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px;">
                                <input type="checkbox" id="pw-wi-toggle" checked>
                                <span style="font-size:0.9em; font-weight:bold;">同步写入世界书</span>
                            </div>
                            <textarea id="pw-res-wi" class="pw-textarea" rows="3" placeholder="世界书条目内容...">${savedState.wiContent || ''}</textarea>
                        </div>
                    </div>
                    <button id="pw-btn-apply" class="pw-btn save" style="margin-top:10px;"><i class="fa-solid fa-check"></i> 保存并切换</button>
                </div>
            </div>
        </div>

        <!-- 2. 世界书视图 -->
        <div id="pw-view-context" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-label">添加参考世界书</div>
                <div class="pw-wi-controls">
                    <select id="pw-wi-select" class="pw-input" style="flex:1;">
                        <option value="">-- 选择世界书 --</option>
                        ${wiOptions}
                    </select>
                    <button id="pw-wi-add" class="pw-btn normal"><i class="fa-solid fa-plus"></i></button>
                </div>
                <div id="pw-wi-container"></div>
            </div>
        </div>

        <!-- 3. API 设置视图 -->
        <div id="pw-view-api" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-api-card">
                    <div class="pw-row">
                        <label>API 来源</label>
                        <select id="pw-api-source" class="pw-input" style="flex:1;">
                            <option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>使用主 API</option>
                            <option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option>
                        </select>
                    </div>
                    
                    <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:10px;">
                        <div class="pw-row">
                            <label>URL</label>
                            <input type="text" id="pw-api-url" class="pw-input" style="flex:1;" value="${config.indepApiUrl}" placeholder="https://api.openai.com/v1">
                        </div>
                        <div class="pw-row">
                            <label>Key</label>
                            <input type="password" id="pw-api-key" class="pw-input" style="flex:1;" value="${config.indepApiKey}">
                        </div>
                        <div class="pw-row">
                            <label>Model</label>
                            <div style="flex:1; display:flex; gap:5px;">
                                <input type="text" id="pw-api-model" class="pw-input" value="${config.indepApiModel}" list="pw-model-list" style="flex:1;">
                                <datalist id="pw-model-list"></datalist>
                                <button id="pw-api-fetch" class="pw-btn normal" title="获取模型列表"><i class="fa-solid fa-cloud-download-alt"></i></button>
                            </div>
                        </div>
                    </div>
                    <div style="text-align:right; margin-top:10px;">
                        <button id="pw-api-save" class="pw-btn primary"><i class="fa-solid fa-save"></i> 保存 API 设置</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 4. 历史视图 [新功能] -->
        <div id="pw-view-history" class="pw-view">
            <div class="pw-scroll-area">
                <div class="pw-history-toolbar">
                    <input type="text" id="pw-history-search" class="pw-history-search" placeholder="🔍 搜索历史 (名称/内容)...">
                    <button id="pw-history-clear-all" class="pw-btn normal" style="color:#ff6b6b; font-size:0.8em;">清空</button>
                </div>
                <div id="pw-history-list" style="display:flex; flex-direction:column; gap:8px;"></div>
            </div>
        </div>
    </div>
    `;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    // ========================================================================
    // 逻辑绑定
    // ========================================================================
    
    // --- 1. 状态保存 ---
    const saveCurrentState = () => {
        saveState({
            request: $('#pw-request').val(),
            name: $('#pw-res-name').val(),
            desc: $('#pw-res-desc').val(),
            wiContent: $('#pw-res-wi').val(),
            hasResult: $('#pw-result-area').is(':visible'),
            localConfig: {
                outputFormat: $('#pw-fmt-select').val(),
                apiSource: $('#pw-api-source').val(),
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(),
                indepApiModel: $('#pw-api-model').val(),
                extraBooks: window.pwExtraBooks || []
            }
        });
    };
    $(document).off('.pw');
    $(document).on('input.pw change.pw', '#pw-request, #pw-res-name, #pw-res-desc, #pw-res-wi, .pw-input', saveCurrentState);

    // --- 2. Tab 切换 ---
    $(document).on('click.pw', '.pw-tab', function() {
        $('.pw-tab').removeClass('active');
        $(this).addClass('active');
        $('.pw-view').removeClass('active');
        const tab = $(this).data('tab');
        $(`#pw-view-${tab}`).addClass('active');
        
        // 切换到历史Tab时自动刷新
        if(tab === 'history') renderHistoryList(); 
    });

    // --- 3. 标签系统 ---
    $(document).on('click.pw', '.pw-tag', function(e) {
        e.preventDefault(); e.stopPropagation();
        
        const idx = $(this).data('idx');
        const tag = tagsCache[idx];
        const $text = $('#pw-request');
        const cur = $text.val();
        
        const insert = tag.value ? `${tag.name}: ${tag.value}` : `${tag.name}: `;
        const prefix = (cur && !cur.endsWith('\n')) ? '\n' : '';
        
        $text.val(cur + prefix + insert).focus();
        $text[0].scrollTop = $text[0].scrollHeight;
        saveCurrentState();
    });

    // 打开标签管理 Overlay
    $('.pw-tags-edit-btn').on('click', () => {
        const renderManager = () => {
            const list = $('#pw-tags-edit-list').empty();
            tagsCache.forEach((t, i) => {
                list.append(`
                    <div class="pw-tag-row">
                        <input class="pw-input t-name" value="${t.name}" placeholder="标签名" style="flex:1;">
                        <input class="pw-input t-val" value="${t.value}" placeholder="默认值" style="flex:1;">
                        <button class="pw-btn normal t-del" style="background:#ff6b6b; color:white; padding:6px 12px;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `);
            });
            
            list.find('input').on('input', function() {
                const row = $(this).closest('.pw-tag-row');
                const idx = row.index();
                tagsCache[idx].name = row.find('.t-name').val();
                tagsCache[idx].value = row.find('.t-val').val();
                saveData();
            });
            
            list.find('.t-del').on('click', function() {
                const idx = $(this).closest('.pw-tag-row').index();
                if(confirm("删除此标签？")) {
                    tagsCache.splice(idx, 1);
                    saveData();
                    renderManager(); 
                    $('#pw-tags-list').html(renderTags());
                }
            });
        };
        renderManager();
        $('#pw-tag-modal').css('display', 'flex'); // Show Overlay
    });

    $('#pw-tags-close, #pw-tags-finish').on('click', () => {
        $('#pw-tag-modal').hide();
        $('#pw-tags-list').html(renderTags()); 
    });

    $('#pw-tags-add-new').on('click', () => {
        tagsCache.push({ name: "新标签", value: "" });
        saveData();
        $('.pw-tags-edit-btn').click();
    });

    // --- 4. 世界书逻辑 ---
    window.pwExtraBooks = savedState.localConfig?.extraBooks || [];
    
    const renderWiBooks = async () => {
        const container = $('#pw-wi-container').empty();
        const baseBooks = await getContextWorldBooks();
        const allBooks = [...new Set([...baseBooks, ...window.pwExtraBooks])];

        if (allBooks.length === 0) {
            container.html('<div style="opacity:0.6; padding:10px; text-align:center;">暂无参考世界书</div>');
            return;
        }

        for (const book of allBooks) {
            const isBound = baseBooks.includes(book);
            const $el = $(`
                <div class="pw-wi-book">
                    <div class="pw-wi-header">
                        <span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="opacity:0.5;font-weight:normal;font-size:0.8em;">(绑定)</span>' : ''}</span>
                        <div>
                            ${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}
                            <i class="fa-solid fa-chevron-down arrow"></i>
                        </div>
                    </div>
                    <div class="pw-wi-list" data-book="${book}"></div>
                </div>
            `);
            
            $el.find('.remove-book').on('click', (e) => {
                e.stopPropagation();
                window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book);
                renderWiBooks();
            });

            $el.find('.pw-wi-header').on('click', async function() {
                const $list = $el.find('.pw-wi-list');
                const $arrow = $(this).find('.arrow');
                
                if ($list.is(':visible')) {
                    $list.slideUp();
                    $arrow.removeClass('fa-flip-vertical');
                } else {
                    $list.slideDown();
                    $arrow.addClass('fa-flip-vertical');
                    
                    if (!$list.data('loaded')) {
                        $list.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                        const entries = await getWorldBookEntries(book);
                        $list.empty();
                        
                        if (entries.length === 0) $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>');
                        
                        entries.forEach(entry => {
                            const isChecked = entry.enabled ? 'checked' : '';
                            const $item = $(`
                                <div class="pw-wi-item">
                                    <div class="pw-wi-item-top">
                                        <input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}">
                                        <span style="font-weight:bold;flex:1;">${entry.displayName}</span>
                                        <i class="fa-solid fa-eye pw-expand-btn" title="预览"></i>
                                    </div>
                                    <div class="pw-wi-content">${entry.content}</div>
                                </div>
                            `);
                            $item.find('.pw-expand-btn').on('click', function() {
                                $(this).closest('.pw-wi-item').find('.pw-wi-content').toggleClass('show');
                            });
                            $list.append($item);
                        });
                        $list.data('loaded', true);
                    }
                }
            });
            container.append($el);
        }
    };
    renderWiBooks();

    $('#pw-wi-add').on('click', () => {
        const val = $('#pw-wi-select').val();
        if (val && !window.pwExtraBooks.includes(val)) {
            window.pwExtraBooks.push(val);
            renderWiBooks();
        }
    });

    // --- 5. API 设置 ---
    $('#pw-api-source').on('change', function() {
        $('#pw-indep-settings').toggle($(this).val() === 'independent');
    });

    $('#pw-api-fetch').on('click', async function() {
        const btn = $(this);
        btn.html('<i class="fas fa-spinner fa-spin"></i>');
        const models = await fetchModels($('#pw-api-url').val(), $('#pw-api-key').val());
        btn.html('<i class="fa-solid fa-cloud-download-alt"></i>');
        
        if (models.length) {
            const list = $('#pw-model-list').empty();
            models.forEach(m => list.append(`<option value="${m}">`));
            toastr.success(TEXT.TOAST_API_OK);
        } else {
            toastr.error(TEXT.TOAST_API_ERR);
        }
    });

    $('#pw-api-save').on('click', () => {
        saveCurrentState();
        toastr.success(TEXT.TOAST_SAVE_API);
    });

    // --- 6. 底部工具栏 ---
    $('#pw-clear').on('click', () => {
        if(confirm("清空输入内容？")) {
            $('#pw-request').val('');
            $('#pw-result-area').hide();
            saveCurrentState();
        }
    });

    // [逻辑更新] 存入历史 - 优先使用生成的角色名
    $('#pw-snapshot').on('click', () => {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curDesc = $('#pw-res-desc').val();
        
        if (!req && !curName) return;
        
        saveHistory({ 
            request: req || "无请求内容", 
            data: { 
                name: curName || "", 
                description: curDesc || "", 
                wi_entry: $('#pw-res-wi').val() 
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // --- 7. 生成 ---
    $('#pw-btn-gen').on('click', async function() {
        const req = $('#pw-request').val();
        const curName = $('#pw-res-name').val();
        const curDesc = $('#pw-res-desc').val();
        
        let fullReq = req;
        if (curName || curDesc) fullReq += `\n\n[Previous Draft]:\nName: ${curName}\nDesc: ${curDesc}`;

        const $btn = $(this);
        const oldText = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 处理中...');

        const wiContext = [];
        $('.pw-wi-check:checked').each(function() {
            wiContext.push(decodeURIComponent($(this).data('content')));
        });

        const config = {
            request: fullReq,
            format: $('#pw-fmt-select').val(),
            wiContext: wiContext,
            apiSource: $('#pw-api-source').val(),
            indepApiUrl: $('#pw-api-url').val(),
            indepApiKey: $('#pw-api-key').val(),
            indepApiModel: $('#pw-api-model').val()
        };

        try {
            const data = await runGeneration(config, config);
            
            $('#pw-res-name').val(data.name);
            $('#pw-res-desc').val(data.description);
            $('#pw-res-wi').val(data.wi_entry || data.description);
            $('#pw-result-area').fadeIn();
            
            saveHistory({ request: req, data });
            saveCurrentState();
        } catch (e) {
            console.error(e);
            toastr.error(`${TEXT.TOAST_GEN_FAIL}: ${e.message}`);
        } finally {
            $btn.prop('disabled', false).html(oldText);
        }
    });

    // --- 8. 应用 ---
    $('#pw-btn-apply').on('click', async function() {
        const name = $('#pw-res-name').val();
        const desc = $('#pw-res-desc').val();
        const wiContent = $('#pw-res-wi').val();
        
        if (!name) return toastr.warning("名字不能为空");
        
        const context = getContext();
        if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
        context.powerUserSettings.personas[name] = desc;
        await saveSettingsDebounced();

        if ($('#pw-wi-toggle').is(':checked') && wiContent) {
            const books = await getContextWorldBooks();
            if (books.length > 0) {
                const book = books[0];
                try {
                    const headers = getRequestHeaders();
                    const r = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name: book }) });
                    if (r.ok) {
                        const d = await r.json();
                        if (!d.entries) d.entries = {};
                        const ids = Object.keys(d.entries).map(Number);
                        const newId = ids.length ? Math.max(...ids) + 1 : 0;
                        d.entries[newId] = { uid: newId, key: [name, "User"], content: wiContent, comment: `User: ${name}`, enabled: true, selective: true };
                        await fetch('/api/worldinfo/edit', { method: 'POST', headers, body: JSON.stringify({ name: book, data: d }) });
                        toastr.success(`WI Updated: ${book}`);
                        if (context.updateWorldInfoList) context.updateWorldInfoList();
                    }
                } catch(e) { console.error(e); }
            }
        }

        if (defaultSettings.autoSwitchPersona) {
            context.powerUserSettings.persona_selected = name;
            $("#your_name").val(name).trigger("input").trigger("change");
            $("#your_desc").val(desc).trigger("input").trigger("change");
        }
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    // --- 9. 历史管理 [全新重写] ---
    const renderHistoryList = () => {
        loadData();
        const $list = $('#pw-history-list').empty();
        const search = $('#pw-history-search').val().toLowerCase();

        // 过滤
        const filtered = historyCache.filter(item => {
            if (!search) return true;
            return (item.data.name && item.data.name.toLowerCase().includes(search)) ||
                   (item.request && item.request.toLowerCase().includes(search)) ||
                   (item.data.description && item.data.description.toLowerCase().includes(search));
        });

        if (filtered.length === 0) {
            $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无历史记录</div>');
            return;
        }

        filtered.forEach((item, index) => {
            const $el = $(`
                <div class="pw-history-item">
                    <div class="pw-hist-content">
                        <div class="pw-hist-title">${item.data.name}</div>
                        <div class="pw-hist-meta">
                            <span><i class="fa-regular fa-clock"></i> ${item.timestamp}</span>
                            <span><i class="fa-solid fa-user"></i> 目标: ${item.targetChar || '未知'}</span>
                        </div>
                        <div class="pw-hist-desc">${item.data.description || item.request || '无描述'}</div>
                    </div>
                    <div class="pw-hist-del" title="删除"><i class="fa-solid fa-trash"></i></div>
                </div>
            `);

            // 点击加载
            $el.on('click', function(e) {
                if ($(e.target).closest('.pw-hist-del').length) return; // Ignore delete click
                $('#pw-request').val(item.request);
                $('#pw-res-name').val(item.data.name);
                $('#pw-res-desc').val(item.data.description);
                $('#pw-res-wi').val(item.data.wi_entry);
                $('#pw-result-area').show();
                $('.pw-tab[data-tab="editor"]').click();
            });

            // 点击删除
            $el.find('.pw-hist-del').on('click', function(e) {
                e.stopPropagation();
                if(confirm(`确定删除 "${item.data.name}" 吗？`)) {
                    // Find actual index in cache (since filter messes up index)
                    const realIndex = historyCache.indexOf(item);
                    if (realIndex > -1) {
                        historyCache.splice(realIndex, 1);
                        saveData();
                        renderHistoryList();
                    }
                }
            });

            $list.append($el);
        });
    };

    // 搜索事件
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);

    // 清空全部事件
    $(document).on('click.pw', '#pw-history-clear-all', function() {
        if (historyCache.length === 0) return;
        if(confirm("确定要清空所有历史记录吗？此操作无法撤销。")) {
            historyCache = [];
            saveData();
            renderHistoryList();
        }
    });
}

// ============================================================================
// 初始化
// ============================================================================

jQuery(async () => {
    injectStyles();
    
    $("#extensions_settings2").append(`
        <div class="world-info-cleanup-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>${TEXT.PANEL_TITLE}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content">
                    <div style="margin:10px 0;"><input id="pw_open_btn" class="menu_button" type="button" value="${TEXT.BTN_OPEN_MAIN}" style="width:100%;font-weight:bold;background:var(--SmartThemeQuoteColor);color:#fff;" /></div>
                </div>
            </div>
        </div>
    `);
    $("#pw_open_btn").on("click", openCreatorPopup);
    console.log(`${extensionName} v8 loaded.`);
});
