import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders, saveChat, reloadCurrentChat, saveCharacterDebounced } from "../../../../script.js";

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v20';
const STORAGE_KEY_STATE = 'pw_state_v20';
const STORAGE_KEY_TEMPLATE = 'pw_template_v2';
const STORAGE_KEY_PROMPTS = 'pw_prompts_v6'; 
const BUTTON_ID = 'pw_persona_tool_btn';

const defaultYamlTemplate =
`基本信息: 
  姓名: {{user}}
  年龄: 
  性别: 
  身高: 
  身份:

背景故事:
  童年_0_12岁: 
  少年_13_18岁: 
  青年_19_35岁: 
  中年_35至今: 
  现状: 

社会地位: 

外貌:
  发型: 
  眼睛: 
  肤色: 
  脸型: 
  体型: 

衣着风格:
  商务正装: 
  商务休闲: 
  休闲装: 
  居家服: 

性格:
  核心特质:
  恋爱特质:

生活习惯:

工作行为:

情绪表现:
  愤怒时: 
  高兴时: 

人生目标:

缺点弱点:

喜好厌恶:
  喜欢:
  讨厌:

能力技能:
  工作相关:
  生活相关:
  爱好特长:

NSFW:
  性相关特征:
    性经验: 
    性取向: 
    性角色: 
    性习惯:
  性癖好:
  禁忌底线:`;

// --- Prompt 定义 ---
const defaultSystemPromptInitial =
`Creating User Persona for {{user}} (Target: {{char}}).
{{wi}}

[Traits / Template]:
{{tags}}

[Instruction]:
{{input}}

[Task]:
Generate character details strictly in structured YAML format.
1. Do NOT wrap the output in a root key like "{{user}}:". Start directly with the first key from the template.
2. Maintain indentation strictly.
3. Do NOT output status bars, progress bars, or Chain of Thought/Reasoning/Thinking process.
4. Response: ONLY the YAML content.`;

const defaultSystemPromptRefine =
`You are an expert Data Converter and Persona Editor.
Optimizing User Persona for {{char}}.
{{wi}}

[Target Schema / Template]:
{{tags}}

[Current Data]:
"""
{{current}}
"""

[Instruction]:
"{{input}}"

[Task]:
1. Parse [Current Data]. If it is unstructured text or uses a different format, MIGRATE it to fit the [Target Schema].
2. Apply the [Instruction] to modify or refine the content.
3. STRICTLY output in valid YAML format following the [Target Schema] structure.
4. Do NOT add a root key wrapper (like "User:").
5. Do NOT output status bars, progress bars, or Chain of Thought.
6. Response: ONLY the final YAML content.`;

const defaultSettings = {
    autoSwitchPersona: true, syncToWorldInfo: false,
    historyLimit: 50, apiSource: 'main',
    indepApiUrl: 'https://api.openai.com/v1', indepApiKey: '', indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: `<span style="color:#e0af68; margin-right:5px;"><i class="fa-solid fa-wand-magic-sparkles"></i></span>User人设生成器`,
    BTN_TITLE: "打开设定生成器",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book) => `已写入世界书: ${book}`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法写入",
    TOAST_WI_ERROR: "TavernHelper API 未加载，无法操作世界书",
    TOAST_SNAPSHOT: "已保存至草稿",
    TOAST_LOAD_CURRENT: "已读取当前酒馆人设内容"
};

let historyCache = [];
let currentTemplate = defaultYamlTemplate;
let promptsCache = { 
    initial: defaultSystemPromptInitial, 
    refine: defaultSystemPromptRefine 
};
let availableWorldBooks = [];
let isEditingTemplate = false;
let pollInterval = null;
let lastRawResponse = "";

// [Fix] 全局处理锁，防止连点
let isProcessing = false;

// ============================================================================
// 工具函数
// ============================================================================
// [Fix] 优化 yield
const yieldToBrowser = () => new Promise(resolve => requestAnimationFrame(resolve));
const forcePaint = () => new Promise(resolve => setTimeout(resolve, 50));

// ============================================================================
// 1. 核心数据解析逻辑
// ============================================================================

function parseYamlToBlocks(text) {
    const map = new Map();
    if (!text || typeof text !== 'string') return map;

    try {
        const cleanText = text.replace(/^```[a-z]*\n?/im, '').replace(/```$/im, '').trim();
        let lines = cleanText.split('\n');

        const topLevelKeyRegex = /^\s*([^:\s\-]+?)\s*[:：]/;
        let topKeysIndices = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length < 200 && topLevelKeyRegex.test(line) && !line.trim().startsWith('-') && line.search(/\S|$/) === 0) {
                topKeysIndices.push(i);
            }
        }

        if (topKeysIndices.length === 1 && lines.length > 2) {
            const firstLineIndex = topKeysIndices[0];
            const remainingLines = lines.slice(firstLineIndex + 1);
            let minIndent = Infinity;
            let hasContent = false;
            for (const l of remainingLines) {
                if (l.trim().length > 0) {
                    const indent = l.search(/\S|$/);
                    if (indent < minIndent) minIndent = indent;
                    hasContent = true;
                }
            }
            if (hasContent && minIndent > 0 && minIndent !== Infinity) {
                lines = remainingLines.map(l => l.length >= minIndent ? l.substring(minIndent) : l);
            }
        }

        let currentKey = null;
        let currentBuffer = [];

        const flushBuffer = () => {
            if (currentKey && currentBuffer.length > 0) {
                let valuePart = "";
                const firstLine = currentBuffer[0];
                const match = firstLine.match(topLevelKeyRegex);
                if (match) {
                    let inlineContent = firstLine.substring(match[0].length).trim();
                    let blockContent = currentBuffer.slice(1).join('\n');
                    if (inlineContent && blockContent) valuePart = inlineContent + '\n' + blockContent;
                    else if (inlineContent) valuePart = inlineContent;
                    else valuePart = blockContent;
                } else {
                    valuePart = currentBuffer.join('\n');
                }
                map.set(currentKey, valuePart);
            }
        };

        lines.forEach((line) => {
            const isTopLevel = (line.length < 200) && topLevelKeyRegex.test(line) && !line.trim().startsWith('-');
            const indentLevel = line.search(/\S|$/);
            if (isTopLevel && indentLevel <= 1) {
                flushBuffer();
                const match = line.match(topLevelKeyRegex);
                currentKey = match[1].trim();
                currentBuffer = [line];
            } else {
                if (currentKey) { currentBuffer.push(line); }
            }
        });
        flushBuffer();
    } catch (e) { console.error("[PW] Parse Error:", e); }
    return map;
}

function findMatchingKey(targetKey, map) {
    if (map.has(targetKey)) return targetKey;
    for (const key of map.keys()) {
        if (key.toLowerCase() === targetKey.toLowerCase()) return key;
    }
    return null;
}

async function collectActiveWorldInfoContent() {
    let content = [];
    try {
        const boundBooks = await getContextWorldBooks();
        const manualBooks = window.pwExtraBooks || [];
        const allBooks = [...new Set([...boundBooks, ...manualBooks])];
        if (allBooks.length > 20) allBooks.length = 20;

        for (const bookName of allBooks) {
            await yieldToBrowser();
            try {
                const entries = await getWorldBookEntries(bookName);
                const enabledEntries = entries.filter(e => e.enabled);
                if (enabledEntries.length > 0) {
                    content.push(`\n--- World Book: ${bookName} ---`);
                    enabledEntries.forEach(e => content.push(`[Entry: ${e.displayName}]\n${e.content}`));
                }
            } catch (err) { }
        }
    } catch (e) { }
    return content;
}

function getActivePersonaDescription() {
    const domVal = $('#persona_description').val();
    if (domVal !== undefined && domVal !== null) return domVal;
    const context = getContext();
    if (context && context.powerUserSettings) {
        if (context.powerUserSettings.persona_description) return context.powerUserSettings.persona_description;
        const selected = context.powerUserSettings.persona_selected;
        if (selected && context.powerUserSettings.personas && context.powerUserSettings.personas[selected]) {
            return context.powerUserSettings.personas[selected];
        }
    }
    return "";
}

// ============================================================================
// 2. 存储与系统函数
// ============================================================================

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try {
        const t = localStorage.getItem(STORAGE_KEY_TEMPLATE);
        if (!t || t.length < 50) currentTemplate = defaultYamlTemplate;
        else currentTemplate = t;
    } catch { currentTemplate = defaultYamlTemplate; }
    try {
        const p = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS));
        promptsCache = { 
            ...{ initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }, 
            ...p 
        };
    } catch { 
        promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine }; 
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TEMPLATE, currentTemplate);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(promptsCache));
}

function saveHistory(item) {
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    
    if (!item.title || item.title === "未命名") {
        const context = getContext();
        const userName = $('.persona_name').first().text().trim() || "User";
        const charName = context.characters[context.characterId]?.name || "Char";
        item.title = `${userName} & ${charName}`;
    }

    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function saveState(data) { localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data)); }
function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }

function injectStyles() {
    const styleId = 'persona-weaver-css-v46-lite'; 
    if ($(`#${styleId}`).length) return;
    
    const css = `
    #pw-api-model-select { flex: 1; width: 0; min-width: 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
    
    .pw-load-btn { font-size: 0.85em; background: linear-gradient(135deg, rgba(224, 175, 104, 0.2), rgba(224, 175, 104, 0.1)); border: 1px solid #e0af68; padding: 4px 12px; border-radius: 4px; cursor: pointer; color: #e0af68; font-weight: bold; margin-left: auto; display: inline-flex; align-items: center; transition: all 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
    .pw-load-btn:hover { background: rgba(224, 175, 104, 0.3); transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.3); color: #fff; }

    .pw-template-textarea { background: rgba(0, 0, 0, 0.5) !important; color: #eee !important; font-family: 'Consolas', 'Monaco', monospace; line-height: 1.4; height: 350px !important; border-radius: 0 0 6px 6px !important; border-top: none !important; }
    
    .pw-shortcut-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4px 10px; height: auto; gap: 2px; min-width: 40px; }
    .pw-shortcut-btn span:first-child { font-size: 0.8em; opacity: 0.8; }
    .pw-shortcut-btn span.code { font-weight: bold; font-family: monospace; color: #e0af68; font-size: 1.1em; }

    .pw-var-btns { gap: 6px; }
    .pw-var-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4px 10px; height: auto; gap: 0; border-color: rgba(128,128,128,0.4); }
    .pw-var-btn span:first-child { font-weight: bold; font-size: 0.8em; }
    .pw-var-btn span.code { font-size: 0.75em; opacity: 0.7; font-family: monospace; }

    #pw-api-url { background-color: rgba(0, 0, 0, 0.2) !important; border: 1px solid var(--SmartThemeBorderColor) !important; color: var(--smart-theme-body-color) !important; }
    .pw-auto-height { min-height: 80px; max-height: 500px; overflow-y: auto; }
    
    #pw-request { transition: none !important; } 

    #pw-history-clear-all { background: transparent; border: none; color: #ff6b6b; font-size: 0.85em; opacity: 0.6; padding: 5px; width: auto; margin: 10px auto; text-decoration: underline; }
    #pw-history-clear-all:hover { opacity: 1; background: transparent; transform: none; }

    .pw-diff-row { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
    .pw-diff-attr-name { font-weight: bold; color: #9ece6a; font-size: 1em; padding-bottom: 5px; border-bottom: 1px solid #333; margin-bottom: 5px; }
    
    .pw-diff-cards { display: flex; gap: 10px; }
    .pw-diff-card { flex: 1; display: flex; flex-direction: column; border: 2px solid transparent; border-radius: 6px; background: #222; overflow: hidden; transition: all 0.2s; cursor: pointer; opacity: 0.6; position: relative; }
    .pw-diff-card.selected { border-color: #9ece6a; opacity: 1; background: #252525; box-shadow: 0 0 10px rgba(158, 206, 106, 0.1); }
    .pw-diff-card:not(.selected):hover { opacity: 0.8; }
    .pw-diff-card.single-view { flex: 1; opacity: 1; background: rgba(158, 206, 106, 0.05); border-color: #9ece6a; cursor: text; }
    
    .pw-diff-label { font-size: 0.75em; padding: 4px 8px; background: rgba(0,0,0,0.3); color: #aaa; text-transform: uppercase; font-weight: bold; }
    .pw-diff-card.selected .pw-diff-label { color: #9ece6a; background: rgba(158, 206, 106, 0.1); }
    
    .pw-diff-textarea { flex: 1; width: 100%; background: transparent; border: none; color: #eee; padding: 8px; font-family: inherit; font-size: 0.95em; resize: none; outline: none; line-height: 1.5; min-height: 80px; box-sizing: border-box; }
    .pw-diff-card:not(.selected) .pw-diff-textarea { color: #888; pointer-events: none; }
    
    @media screen and (max-width: 600px) { .pw-diff-cards { flex-direction: column; } }
    
    .pw-btn.wi { background: linear-gradient(135deg, rgba(122, 162, 247, 0.2), rgba(0, 0, 0, 0)); border-color: #7aa2f7; color: #7aa2f7; }

    .pw-tab-sub { display: block; font-size: 0.75em; opacity: 0.6; font-weight: normal; margin-top: 2px; text-align: center; }
    .pw-diff-tab { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }

    .pw-header-subtitle { font-size: 0.65em; opacity: 0.6; font-weight: normal; margin-left: 10px; color: #ccc; }
    
    .pw-diff-raw-textarea { min-height: 350px !important; }

    .pw-float-quote-btn { position: fixed; top: calc(20% + 60px); right: 0; background: linear-gradient(135deg, #e0af68, #d08f40); color: #1a1a1a; padding: 8px 12px; border-radius: 20px 0 0 20px; font-weight: bold; font-size: 0.85em; box-shadow: -2px 2px 8px rgba(0,0,0,0.4); cursor: pointer; z-index: 9999; display: none; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,0.3); border-right: none; backdrop-filter: blur(5px); }
    .pw-float-quote-btn:hover { padding-right: 18px; transform: translateX(-2px); }
    `;
    $('<style>').attr('id', styleId).text(css).appendTo('head');
}

async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;
    context.powerUserSettings.persona_selected = name;
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    if ($nameInput.length) $nameInput.val(name).trigger('input').trigger('change');
    if ($descInput.length) $descInput.val(description).trigger('input').trigger('change');
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);
    await saveSettingsDebounced();
    return true;
}

async function syncToWorldInfoViaHelper(userName, content) {
    if (!window.TavernHelper) return toastr.error(TEXT.TOAST_WI_ERROR);
    let targetBook = null;
    try {
        const charBooks = window.TavernHelper.getCharWorldbookNames('current');
        if (charBooks && charBooks.primary) targetBook = charBooks.primary;
        else if (charBooks && charBooks.additional && charBooks.additional.length > 0) targetBook = charBooks.additional[0];
    } catch (e) { }
    if (!targetBook) {
        const boundBooks = await getContextWorldBooks();
        if (boundBooks.length > 0) targetBook = boundBooks[0];
    }
    if (!targetBook) return toastr.warning(TEXT.TOAST_WI_FAIL);
    try {
        const entries = await window.TavernHelper.getLorebookEntries(targetBook);
        const entryComment = `User: ${userName}`;
        const existingEntry = entries.find(e => e.comment === entryComment);
        if (existingEntry) {
            await window.TavernHelper.setLorebookEntries(targetBook, [{ uid: existingEntry.uid, content: content, enabled: true }]);
        } else {
            const newEntry = { comment: entryComment, keys: [userName, "User"], content: content, enabled: true, selective: true, constant: false, position: { type: 'before_character_definition' } };
            await window.TavernHelper.createLorebookEntries(targetBook, [newEntry]);
        }
        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
    } catch (e) { toastr.error("写入世界书失败"); }
}

async function loadAvailableWorldBooks() {
    availableWorldBooks = [];
    if (window.TavernHelper && typeof window.TavernHelper.getWorldbookNames === 'function') {
        try { availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch { }
    }
    if (availableWorldBooks.length === 0 && window.world_names && Array.isArray(window.world_names)) {
        availableWorldBooks = window.world_names;
    }
    if (availableWorldBooks.length === 0) {
        try {
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (r.ok) { const d = await r.json(); availableWorldBooks = d.world_names || d; }
        } catch (e) { }
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
        if (data.character_book?.name) books.add(data.character_book.name);
        if (data.extensions?.world) books.add(data.extensions.world);
        if (data.world) books.add(data.world);
        if (context.chatMetadata?.world_info) books.add(context.chatMetadata.world_info);
    }
    return Array.from(books).filter(Boolean);
}

async function getWorldBookEntries(bookName) {
    if (window.TavernHelper && typeof window.TavernHelper.getLorebookEntries === 'function') {
        try {
            const entries = await window.TavernHelper.getLorebookEntries(bookName);
            return entries.map(e => ({ uid: e.uid, displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题", content: e.content || "", enabled: e.enabled }));
        } catch (e) { }
    }
    return [];
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const charId = context.characterId;
    const charName = (charId !== undefined) ? context.characters[charId].name : "None";
    const currentName = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";

    if (!promptsCache || !promptsCache.initial) loadData(); 

    let wiText = "";
    if (data.wiContext && data.wiContext.length > 0) {
        wiText = `\n[Context from World Info]:\n${data.wiContext.join('\n')}\n`;
    }

    let systemTemplate = promptsCache.initial;
    if (data.mode === 'refine') systemTemplate = promptsCache.refine;

    let systemPrompt = systemTemplate
        .replace(/{{user}}/g, currentName)
        .replace(/{{char}}/g, charName)
        .replace(/{{wi}}/g, wiText)
        .replace(/{{tags}}/g, currentTemplate)
        .replace(/{{input}}/g, data.request)
        .replace(/{{current}}/g, data.currentText || "");

    let responseContent = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); 

    try {
        if (apiConfig.apiSource === 'independent') {
            let baseUrl = apiConfig.indepApiUrl.replace(/\/$/, '');
            if (baseUrl.endsWith('/chat/completions')) baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
            const url = `${baseUrl}/chat/completions`;
            const messages = [{ role: 'user', content: systemPrompt }];
            const res = await fetch(url, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
                body: JSON.stringify({ model: apiConfig.indepApiModel, messages: messages, temperature: 0.7 }),
                signal: controller.signal
            });
            const text = await res.text();
            let json;
            try { json = JSON.parse(text); } catch (e) { throw new Error(`API 返回非 JSON: ${text.slice(0, 100)}...`); }
            if (!res.ok) {
                const errorMsg = json.error?.message || json.message || JSON.stringify(json);
                throw new Error(`API 请求失败 [${res.status}]: ${errorMsg}`);
            }
            if (!json.choices || !json.choices.length) throw new Error("API 返回格式错误: 找不到 choices");
            responseContent = json.choices[0].message.content;
        } else {
            if (typeof context.generateQuietPrompt !== 'function') throw new Error("ST版本过旧，不支持后台生成");
            responseContent = await context.generateQuietPrompt(systemPrompt, false, false, null, "System");
        }
    } finally { clearTimeout(timeoutId); }
    
    lastRawResponse = responseContent;
    return responseContent.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
}

// ============================================================================
// 3. UI 渲染 logic
// ============================================================================

async function openCreatorPopup() {
    const context = getContext();
    loadData();
    await loadAvailableWorldBooks();
    const savedState = loadState();
    const config = { ...defaultSettings, ...extension_settings[extensionName], ...savedState.localConfig };

    let currentName = $('.persona_name').first().text().trim();
    if (!currentName) currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

    const activePersonaContent = getActivePersonaDescription();
    
    let autoFilledResult = savedState.resultText || "";
    let shouldShowResult = savedState.hasResult || false;

    if (!autoFilledResult && activePersonaContent && activePersonaContent.trim()) {
        autoFilledResult = activePersonaContent;
        shouldShowResult = true;
    }

    const renderBookOptions = () => {
        if (availableWorldBooks.length > 0) {
            return availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('');
        }
        return `<option disabled>未找到世界书</option>`;
    };

    const charName = getContext().characters[getContext().characterId]?.name || "None";
    const headerTitle = `${TEXT.PANEL_TITLE}<span class="pw-header-subtitle">User: ${currentName} & Char: ${charName}</span>`;

    const html = `
<div class="pw-wrapper">
    <div class="pw-header">
        <div class="pw-top-bar"><div class="pw-title">${headerTitle}</div></div>
        <div class="pw-tabs">
            <div class="pw-tab active" data-tab="editor">人设</div>
            <div class="pw-tab" data-tab="context">世界书</div>
            <div class="pw-tab" data-tab="api">API & Prompt</div>
            <div class="pw-tab" data-tab="history">草稿</div>
        </div>
    </div>

    <div id="pw-view-editor" class="pw-view active">
        <div class="pw-scroll-area">
            <div class="pw-info-display">
                <div class="pw-info-item"><i class="fa-solid fa-user"></i><span id="pw-display-name">${currentName}</span></div>
                <div class="pw-load-btn" id="pw-btn-load-current">载入当前人设</div>
            </div>

            <div>
                <div class="pw-tags-header">
                    <span class="pw-tags-label">模版块 (点击填入)</span>
                    <div class="pw-tags-actions">
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-template">编辑模版</span>
                    </div>
                </div>
                <div class="pw-tags-container" id="pw-template-chips"></div>
                
                <div class="pw-template-editor-area" id="pw-template-editor">
                    <div class="pw-template-footer" style="border-top:none; border-bottom:1px solid var(--SmartThemeBorderColor); border-radius:6px 6px 0 0;">
                        <div class="pw-shortcut-bar">
                            <div class="pw-shortcut-btn" data-key="  "><span>缩进</span><span class="code">Tab</span></div>
                            <div class="pw-shortcut-btn" data-key=": "><span>冒号</span><span class="code">:</span></div>
                            <div class="pw-shortcut-btn" data-key="- "><span>列表</span><span class="code">-</span></div>
                            <div class="pw-shortcut-btn" data-key="\n"><span>换行</span><span class="code">Enter</span></div>
                        </div>
                        <button class="pw-mini-btn" id="pw-save-template">保存模版</button>
                    </div>
                    <textarea id="pw-template-text" class="pw-template-textarea">${currentTemplate}</textarea>
                </div>
            </div>

            <textarea id="pw-request" class="pw-textarea pw-auto-height" placeholder="在此输入要求，或点击上方模版块插入...">${savedState.request || ''}</textarea>
            <button id="pw-btn-gen" class="pw-btn gen">生成设定</button>

            <div id="pw-result-area" style="display:none; margin-top:15px;">
                <div class="pw-relative-container">
                    <textarea id="pw-result-text" class="pw-result-textarea pw-auto-height" placeholder="生成的结果将显示在这里..." style="min-height: 200px;"></textarea>
                </div>
                
                <div class="pw-refine-toolbar">
                    <textarea id="pw-refine-input" class="pw-refine-input" placeholder="输入意见，或选中上方文字后点击浮窗快速修改..."></textarea>
                    <div class="pw-refine-btn-vertical" id="pw-btn-refine" title="执行润色">
                        <span class="pw-refine-btn-text">润色</span>
                        <i class="fa-solid fa-magic"></i>
                    </div>
                </div>
            </div>
        </div>

        <div class="pw-footer">
            <div class="pw-footer-group">
                <div class="pw-compact-btn danger" id="pw-clear" title="清空"><i class="fa-solid fa-eraser"></i></div>
                <div class="pw-compact-btn" id="pw-copy-persona" title="复制内容"><i class="fa-solid fa-copy"></i></div>
                <div class="pw-compact-btn" id="pw-snapshot" title="保存草稿"><i class="fa-solid fa-save"></i></div>
            </div>
            <div class="pw-footer-group" style="flex:1; justify-content:flex-end; gap: 8px;">
                <button class="pw-btn wi" id="pw-btn-save-wi">保存至世界书</button>
                <button class="pw-btn save" id="pw-btn-apply">覆盖当前人设</button>
            </div>
        </div>
    </div>

    <div id="pw-diff-overlay" class="pw-diff-container" style="display:none;">
        <div class="pw-diff-tabs-bar">
            <div class="pw-diff-tab active" data-view="diff">
                <div>智能对比</div><div class="pw-tab-sub">选择编辑</div>
            </div>
            <div class="pw-diff-tab" data-view="raw">
                <div>新版原文</div><div class="pw-tab-sub">直接编辑</div>
            </div>
        </div>
        
        <div class="pw-diff-content-area">
            <div id="pw-diff-list-view" class="pw-diff-list-view">
                <div id="pw-diff-list" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
            <div id="pw-diff-raw-view" class="pw-diff-raw-view">
                <textarea id="pw-diff-raw-textarea" class="pw-diff-raw-textarea" spellcheck="false"></textarea>
            </div>
        </div>

        <div class="pw-diff-actions">
            <button class="pw-btn danger" id="pw-diff-cancel">放弃修改</button>
            <button class="pw-btn save" id="pw-diff-confirm">保存并应用</button>
        </div>
    </div>

    <div id="pw-float-quote-btn" class="pw-float-quote-btn"><i class="fa-solid fa-pen-to-square"></i> 修改此段</div>

    <div id="pw-view-context" class="pw-view"><div class="pw-scroll-area"><div class="pw-card-section"><div class="pw-wi-controls"><select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">-- 添加参考/目标世界书 --</option>${renderBookOptions()}</select><button id="pw-wi-refresh" class="pw-btn primary pw-wi-refresh-btn"><i class="fa-solid fa-sync"></i></button><button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button></div></div><div id="pw-wi-container"></div></div></div>
    
    <div id="pw-view-api" class="pw-view">
        <div class="pw-scroll-area">
            <div class="pw-card-section">
                <div class="pw-row"><label>API 来源</label><select id="pw-api-source" class="pw-input" style="flex:1;"><option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>主 API</option><option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option></select></div>
                <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px;">
                    <div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;" placeholder="http://.../v1"></div>
                    <div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div>
                    <div class="pw-row"><label>Model</label>
                        <div style="flex:1; display:flex; gap:5px; width:100%; min-width: 0;">
                            <select id="pw-api-model-select" class="pw-select" style="flex:1;"><option value="${config.indepApiModel}">${config.indepApiModel}</option></select>
                            <button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="刷新模型列表" style="width:auto;"><i class="fa-solid fa-sync"></i></button>
                            <button id="pw-api-test" class="pw-btn primary" style="width:auto;" title="测试连接"><i class="fa-solid fa-plug"></i></button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="pw-card-section pw-prompt-editor-block">
                <div style="display:flex; justify-content:space-between;"><span class="pw-prompt-label">人设初始生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-initial" style="font-size:0.7em;">恢复默认</button></div>
                <div class="pw-var-btns">
                    <div class="pw-var-btn" data-ins="{{user}}"><span>User名</span><span class="code">{{user}}</span></div>
                    <div class="pw-var-btn" data-ins="{{char}}"><span>Char名</span><span class="code">{{char}}</span></div>
                    <div class="pw-var-btn" data-ins="{{tags}}"><span>模版内容</span><span class="code">{{tags}}</span></div>
                    <div class="pw-var-btn" data-ins="{{input}}"><span>用户要求</span><span class="code">{{input}}</span></div>
                    <div class="pw-var-btn" data-ins="{{wi}}"><span>世界书内容</span><span class="code">{{wi}}</span></div>
                </div>
                <textarea id="pw-prompt-initial" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.initial}</textarea>
                
                <div style="display:flex; justify-content:space-between; margin-top:15px;"><span class="pw-prompt-label">人设润色指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-refine" style="font-size:0.7em;">恢复默认</button></div>
                <div class="pw-var-btns">
                    <div class="pw-var-btn" data-ins="{{tags}}"><span>模版(必要)</span><span class="code">{{tags}}</span></div>
                    <div class="pw-var-btn" data-ins="{{current}}"><span>当前文本</span><span class="code">{{current}}</span></div>
                    <div class="pw-var-btn" data-ins="{{input}}"><span>润色意见</span><span class="code">{{input}}</span></div>
                </div>
                <textarea id="pw-prompt-refine" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.refine}</textarea>
            </div>
            <div style="text-align:right; margin-top:5px;"><button id="pw-api-save" class="pw-btn primary" style="width:100%;">保存 Prompts</button></div>
        </div>
    </div>

    <div id="pw-view-history" class="pw-view"><div class="pw-scroll-area"><div class="pw-search-box"><i class="fa-solid fa-search pw-search-icon"></i><input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="搜索历史..."><i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i></div><div id="pw-history-list" style="display:flex; flex-direction:column;"></div><button id="pw-history-clear-all" class="pw-btn">清空所有草稿</button></div></div>
</div>
`;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    renderTemplateChips();
    renderWiBooks();

    $('.pw-auto-height').each(function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    if (autoFilledResult) {
        $('#pw-result-text').val(autoFilledResult);
        if (shouldShowResult) {
            $('#pw-result-area').show();
            $('#pw-request').addClass('minimized');
        }
    }
}

// ============================================================================
// 4. 事件绑定
// ============================================================================

function bindEvents() {
    if (window.stPersonaWeaverBound) return;
    window.stPersonaWeaverBound = true;

    console.log("[PW] Binding Events (Lite)...");

    // --- 复制功能 ---
    $(document).on('click.pw', '#pw-copy-persona', function() {
        const text = $('#pw-result-text').val();
        if(!text) return toastr.warning("没有内容可复制");
        navigator.clipboard.writeText(text);
        toastr.success("人设已复制");
    });

    // --- Tabs ---
    $(document).on('click.pw', '.pw-tab', function () {
        $('.pw-tab').removeClass('active'); $(this).addClass('active');
        $('.pw-view').removeClass('active');
        $(`#pw-view-${$(this).data('tab')}`).addClass('active');
        if ($(this).data('tab') === 'history') renderHistoryList();
    });

    // --- Template Editing ---
    $(document).on('click.pw', '#pw-toggle-edit-template', () => {
        isEditingTemplate = !isEditingTemplate;
        if (isEditingTemplate) {
            $('#pw-template-text').val(currentTemplate);
            $('#pw-template-chips').hide();
            $('#pw-template-editor').css('display', 'flex');
            $('#pw-toggle-edit-template').text("取消编辑").css('color', '#ff6b6b');
        } else {
            $('#pw-template-editor').hide();
            $('#pw-template-chips').css('display', 'flex');
            $('#pw-toggle-edit-template').text("编辑模版").css('color', '#5b8db8');
        }
    });

    $(document).on('click.pw', '#pw-save-template', () => {
        const val = $('#pw-template-text').val();
        currentTemplate = val;
        saveData();
        renderTemplateChips();
        isEditingTemplate = false;
        $('#pw-template-editor').hide();
        $('#pw-template-chips').css('display', 'flex');
        $('#pw-toggle-edit-template').text("编辑模版").css('color', '#5b8db8');
        toastr.success("模版已更新");
    });

    // --- Shortcuts ---
    $(document).on('click.pw', '.pw-shortcut-btn', function () {
        const key = $(this).data('key');
        const $text = $('#pw-template-text');
        const el = $text[0];
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const insertText = key === '\n' ? '\n' : key;
        el.value = val.substring(0, start) + insertText + val.substring(end);
        el.selectionStart = el.selectionEnd = start + insertText.length;
        el.focus();
    });

    $(document).on('click.pw', '.pw-var-btn', function () {
        const ins = $(this).data('ins');
        const $activeText = $(this).parent().next('textarea');
        if ($activeText.length) {
            const el = $activeText[0];
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const val = el.value;
            el.value = val.substring(0, start) + ins + val.substring(end);
            el.selectionStart = el.selectionEnd = start + ins.length;
            el.focus();
        }
    });

    // --- Float Button Selection Check ---
    let selectionTimeout;
    const checkSelection = () => {
        clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
            const activeEl = document.activeElement;
            if (!activeEl || !activeEl.id.startsWith('pw-result-text')) return;
            
            const hasSelection = activeEl.selectionStart !== activeEl.selectionEnd;
            const $btn = $('#pw-float-quote-btn');
            if (hasSelection) {
                if (!$btn.is(':visible')) $btn.stop(true, true).fadeIn(200).css('display', 'flex');
            } else {
                if ($btn.is(':visible')) $btn.stop(true, true).fadeOut(200);
            }
        }, 100);
    };
    $(document).on('touchend mouseup keyup', '#pw-result-text', checkSelection);

    $(document).on('mousedown.pw', '#pw-float-quote-btn', function (e) {
        e.preventDefault(); 
        e.stopPropagation();
        
        const activeEl = document.activeElement;
        if (!activeEl) return;

        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const selectedText = activeEl.value.substring(start, end).trim();
        
        if (selectedText) {
            let $input = $('#pw-refine-input');
            if ($input && $input.length) {
                const cur = $input.val();
                const newText = `对 "${selectedText}" 的修改意见为：`;
                $input.val(cur ? cur + '\n' + newText : newText).focus();
                activeEl.setSelectionRange(end, end); 
                $('#pw-float-quote-btn').fadeOut(100);
            }
        }
    });

    const adjustHeight = (el) => {
        requestAnimationFrame(() => {
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight) + 'px';
        });
    };
    $(document).on('input.pw', '.pw-auto-height, #pw-refine-input, .pw-card-refine-input', function () { adjustHeight(this); });

    let saveTimeout;
    const saveCurrentState = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveState({
                request: $('#pw-request').val(),
                resultText: $('#pw-result-text').val(),
                hasResult: $('#pw-result-area').is(':visible'),
                localConfig: {
                    apiSource: $('#pw-api-source').val(),
                    indepApiUrl: $('#pw-api-url').val(),
                    indepApiKey: $('#pw-api-key').val(),
                    indepApiModel: $('#pw-api-model-select').val() || $('#pw-api-model').val(),
                    extraBooks: window.pwExtraBooks || []
                }
            });
        }, 500);
    };
    $(document).on('input.pw change.pw', '#pw-request, #pw-result-text, #pw-wi-toggle, .pw-input, .pw-select', saveCurrentState);

    // --- Diff View Logic ---
    $(document).on('click.pw', '.pw-diff-tab', function () {
        $('.pw-diff-tab').removeClass('active');
        $(this).addClass('active');
        const view = $(this).data('view');
        
        if (view === 'diff') { 
            $('#pw-diff-list-view').show();
            $('#pw-diff-raw-view').hide();
        } else { 
            $('#pw-diff-list-view').hide();
            $('#pw-diff-raw-view').show();
        }
    });

    // Refine (Persona)
    $(document).on('click.pw', '#pw-btn-refine', async function (e) {
        e.preventDefault();
        
        if (isProcessing) return;
        isProcessing = true;

        console.log("[PW] Refine Clicked");
        const refineReq = $('#pw-refine-input').val();
        if (!refineReq) {
            toastr.warning("请输入润色意见");
            isProcessing = false;
            return;
        }
        
        if(!promptsCache.initial) loadData();

        const oldText = $('#pw-result-text').val();
        const $btn = $(this).find('i').removeClass('fa-magic').addClass('fa-spinner fa-spin');
        
        await forcePaint();

        try {
            const wiContent = await collectActiveWorldInfoContent();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'refine', request: refineReq, currentText: oldText, wiContext: wiContent,
                apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), indepApiModel: modelVal
            };
            const responseText = await runGeneration(config, config);

            $('#pw-diff-raw-textarea').val(lastRawResponse);

            const oldMap = parseYamlToBlocks(oldText);
            const newMap = parseYamlToBlocks(responseText);
            const allKeys = [...new Set([...oldMap.keys(), ...newMap.keys()])];

            const $list = $('#pw-diff-list').empty();
            let changeCount = 0;

            allKeys.forEach(key => {
                const matchedKeyInOld = findMatchingKey(key, oldMap) || key;
                const matchedKeyInNew = findMatchingKey(key, newMap) || key;
                const valOld = oldMap.get(matchedKeyInOld) || "";
                const valNew = newMap.get(matchedKeyInNew) || "";

                const isChanged = valOld.trim() !== valNew.trim();
                if (isChanged) changeCount++;
                if (!valOld && !valNew) return;

                let cardsHtml = '';
                if (!isChanged) {
                    cardsHtml = `
                    <div class="pw-diff-card new selected single-view" data-val="${encodeURIComponent(valNew)}">
                        <div class="pw-diff-label">无变更</div>
                        <textarea class="pw-diff-textarea">${valNew}</textarea>
                    </div>`;
                } else {
                    cardsHtml = `
                    <div class="pw-diff-card old" data-val="${encodeURIComponent(valOld)}">
                        <div class="pw-diff-label">原版本</div>
                        <textarea class="pw-diff-textarea" readonly>${valOld || "(无)"}</textarea>
                    </div>
                    <div class="pw-diff-card new selected" data-val="${encodeURIComponent(valNew)}">
                        <div class="pw-diff-label">新版本</div>
                        <textarea class="pw-diff-textarea">${valNew || "(删除)"}</textarea>
                    </div>`;
                }

                const rowHtml = `
                <div class="pw-diff-row" data-key="${key}">
                    <div class="pw-diff-attr-name">${key}</div>
                    <div class="pw-diff-cards">
                        ${cardsHtml}
                    </div>
                </div>`;
                $list.append(rowHtml);
            });

            $('#pw-diff-overlay').data('source', 'persona');
            
            // Restore Tab names
            $('.pw-diff-tab[data-view="diff"] div:first-child').text('智能对比');
            $('.pw-diff-tab[data-view="diff"] .pw-tab-sub').text('选择编辑');
            $('.pw-diff-tab[data-view="raw"] div:first-child').text('新版原文');
            $('.pw-diff-tab[data-view="raw"] .pw-tab-sub').text('直接编辑');

            if (changeCount === 0 && !responseText) {
                toastr.warning("返回内容为空，请切换到“直接编辑”查看");
            } else if (changeCount === 0) {
                toastr.info("没有检测到内容变化");
            }

            $('.pw-diff-tab[data-view="diff"]').click();
            $('#pw-diff-overlay').fadeIn();
            $('#pw-refine-input').val('');
        } catch (e) { 
            console.error(e);
            toastr.error("润色失败: " + e.message); 
        } finally { 
            $btn.removeClass('fa-spinner fa-spin').addClass('fa-magic');
            isProcessing = false;
        }
    });

    $(document).on('click.pw', '.pw-diff-card', function () {
        const $row = $(this).closest('.pw-diff-row');
        if ($(this).hasClass('single-view')) return;

        $row.find('.pw-diff-card').removeClass('selected');
        $(this).addClass('selected');
        
        $row.find('.pw-diff-textarea').prop('readonly', true);
        $(this).find('.pw-diff-textarea').prop('readonly', false).focus();
    });

    $(document).on('click.pw', '#pw-diff-confirm', function () {
        const activeTab = $('.pw-diff-tab.active').data('view');
        
        let finalContent = "";

        if (activeTab === 'raw') {
            finalContent = $('#pw-diff-raw-textarea').val();
        } else {
            let finalLines = [];
            $('.pw-diff-row').each(function () {
                const key = $(this).data('key');
                const val = $(this).find('.pw-diff-card.selected .pw-diff-textarea').val().trimEnd();
                if (val && val !== "(删除)" && val !== "(无)") {
                    if (val.includes('\n') || val.startsWith('  ')) finalLines.push(`${key}:\n${val}`);
                    else finalLines.push(`${key}: ${val.trim()}`);
                }
            });
            finalContent = finalLines.join('\n\n');
        }
        $('#pw-result-text').val(finalContent).trigger('input');

        $('#pw-diff-overlay').fadeOut();
        saveCurrentState();
        toastr.success("修改已应用");
    });

    $(document).on('click.pw', '#pw-diff-cancel', () => $('#pw-diff-overlay').fadeOut());

    // Generate Persona
    $(document).on('click.pw', '#pw-btn-gen', async function (e) {
        e.preventDefault();
        
        if (isProcessing) return;
        isProcessing = true;

        console.log("[PW] Gen Clicked");
        const req = $('#pw-request').val();
        if (!req) {
            toastr.warning("请输入要求");
            isProcessing = false;
            return;
        }
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');
        
        await forcePaint();
        
        $('#pw-refine-input').val('');
        $('#pw-result-text').val('');

        try {
            const wiContent = await collectActiveWorldInfoContent();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'initial', request: req, wiContext: wiContent,
                apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), indepApiModel: modelVal
            };
            const text = await runGeneration(config, config);
            $('#pw-result-text').val(text);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        } catch (e) { 
            console.error(e);
            toastr.error("生成失败: " + e.message); 
        } finally { 
            $btn.prop('disabled', false).html('生成设定'); 
            isProcessing = false;
        }
    });

    $(document).on('click.pw', '#pw-btn-load-current', function() {
        const content = getActivePersonaDescription();
        if (content) {
            if ($('#pw-result-text').val() && !confirm("当前结果框已有内容，确定要覆盖吗？")) return;
            $('#pw-result-text').val(content);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            toastr.success(TEXT.TOAST_LOAD_CURRENT);
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        } else {
            toastr.warning("未检测到有效的人设描述");
        }
    });

    $(document).on('click.pw', '#pw-btn-save-wi', async function () {
        const content = $('#pw-result-text').val();
        if (!content) return toastr.warning("内容为空，无法保存");
        const name = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";
        await syncToWorldInfoViaHelper(name, content);
    });

    $(document).on('click.pw', '#pw-btn-apply', async function () {
        const content = $('#pw-result-text').val();
        if (!content) return toastr.warning("内容为空");
        const name = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";
        await forceSavePersona(name, content);
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    $(document).on('click.pw', '#pw-clear', function () {
        if (confirm("确定清空？")) {
            $('#pw-request').val('').removeClass('minimized');
            $('#pw-result-area').hide();
            $('#pw-result-text').val('');
            saveCurrentState();
        }
    });

    // Save Draft (Persona)
    $(document).on('click.pw', '#pw-snapshot', function () {
        const text = $('#pw-result-text').val();
        const req = $('#pw-request').val();
        if (!text && !req) return toastr.warning("没有任何内容可保存");
        saveHistory({ 
            request: req || "无", 
            timestamp: new Date().toLocaleString(), 
            title: "", // Let default logic handle it
            data: { name: "Persona", resultText: text || "(无)", type: 'persona' } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    $(document).on('click.pw', '.pw-hist-action-btn.edit', function (e) {
        e.stopPropagation();
        const $header = $(this).closest('.pw-hist-header');
        const $display = $header.find('.pw-hist-title-display');
        const $input = $header.find('.pw-hist-title-input');
        $display.hide(); $input.show().focus();
        const saveEdit = () => {
            const newVal = $input.val();
            $display.text(newVal).show(); $input.hide();
            const index = $header.closest('.pw-history-item').find('.pw-hist-action-btn.del').data('index');
            if (historyCache[index]) { historyCache[index].title = newVal; saveData(); }
            $(document).off('click.pw-hist-blur');
        };
        $input.one('blur keyup', function (ev) { if (ev.type === 'keyup' && ev.key !== 'Enter') return; saveEdit(); });
    });

    $(document).on('change.pw', '#pw-api-source', function () { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });

    $(document).on('click.pw', '#pw-api-fetch', async function (e) {
        e.preventDefault();
        const url = $('#pw-api-url').val().replace(/\/$/, '');
        const key = $('#pw-api-key').val();
        const $btn = $(this).find('i').addClass('fa-spin');
        try {
            const endpoints = [url.includes('v1') ? `${url}/models` : `${url}/v1/models`, `${url}/models`];
            let data = null;
            for (const ep of endpoints) {
                try {
                    const res = await fetch(ep, { method: 'GET', headers: { 'Authorization': `Bearer ${key}` } });
                    if (res.ok) { data = await res.json(); break; }
                } catch { }
            }
            if (!data) throw new Error("连接失败或无法获取模型列表");
            const models = (data.data || data).map(m => m.id).sort();
            const $select = $('#pw-api-model-select').empty();
            models.forEach(m => $select.append(`<option value="${m}">${m}</option>`));
            if (models.length > 0) $select.val(models[0]);
            toastr.success(`获取到 ${models.length} 个模型`);
        } catch (e) { toastr.error(e.message); }
        finally { $btn.removeClass('fa-spin'); }
    });

    $(document).on('click.pw', '#pw-api-test', async function (e) {
        e.preventDefault();
        const url = $('#pw-api-url').val().replace(/\/$/, '');
        const key = $('#pw-api-key').val();
        const model = $('#pw-api-model-select').val();
        const $btn = $(this).html('<i class="fas fa-spinner fa-spin"></i>');
        try {
            const ep = url.includes('v1') ? `${url}/chat/completions` : `${url}/v1/chat/completions`;
            const res = await fetch(ep, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
            });
            if (res.ok) toastr.success("连接成功！");
            else toastr.error(`失败: ${res.status}`);
        } catch (e) { toastr.error("请求发送失败"); }
        finally { $btn.html('<i class="fa-solid fa-plug"></i>'); }
    });

    $(document).on('click.pw', '#pw-api-save', () => {
        promptsCache.initial = $('#pw-prompt-initial').val();
        promptsCache.refine = $('#pw-prompt-refine').val();
        saveData();
        toastr.success("设置与Prompt已保存");
    });

    $(document).on('click.pw', '#pw-reset-initial', () => {
        if (confirm("恢复初始生成Prompt？")) $('#pw-prompt-initial').val(defaultSystemPromptInitial);
    });
    $(document).on('click.pw', '#pw-reset-refine', () => {
        if (confirm("恢复润色Prompt？")) $('#pw-prompt-refine').val(defaultSystemPromptRefine);
    });

    $(document).on('click.pw', '#pw-wi-refresh', async function() {
        const btn = $(this); btn.find('i').addClass('fa-spin');
        await loadAvailableWorldBooks();
        const options = availableWorldBooks.length > 0 ? availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('') : `<option disabled>未找到世界书</option>`;
        $('#pw-wi-select').html(`<option value="">-- 添加参考/目标世界书 --</option>${options}`);
        btn.find('i').removeClass('fa-spin'); toastr.success("已刷新");
    });
    $(document).on('click.pw', '#pw-wi-add', () => { const val = $('#pw-wi-select').val(); if (val && !window.pwExtraBooks.includes(val)) { window.pwExtraBooks.push(val); renderWiBooks(); } });
    $(document).on('input.pw', '#pw-history-search', renderHistoryList);
    $(document).on('click.pw', '#pw-history-search-clear', function () { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function () { if (confirm("清空?")) { historyCache = []; saveData(); renderHistoryList(); } });
}

// ... 辅助渲染函数 ...
const renderTemplateChips = () => {
    const $container = $('#pw-template-chips').empty();
    const blocks = parseYamlToBlocks(currentTemplate);
    blocks.forEach((content, key) => {
        const $chip = $(`<div class="pw-tag-chip"><i class="fa-solid fa-cube" style="opacity:0.5; margin-right:4px;"></i><span>${key}</span></div>`);
        $chip.on('click', () => {
            const $text = $('#pw-request');
            const cur = $text.val();
            const prefix = (cur && !cur.endsWith('\n') && cur.length > 0) ? '\n\n' : '';
            let insertText = key + ":";
            if (content && content.trim()) {
                if (content.includes('\n') || content.startsWith(' ')) insertText += "\n" + content;
                else insertText += " " + content;
            } else insertText += " ";
            $text.val(cur + prefix + insertText).focus();
            $text.scrollTop($text[0].scrollHeight);
        });
        $container.append($chip);
    });
};

const renderHistoryList = () => {
    loadData();
    const $list = $('#pw-history-list').empty();
    const search = $('#pw-history-search').val().toLowerCase();
    
    // [Lite Fix] Filter out opening types
    const filtered = historyCache.filter(item => {
        if (item.data && item.data.type === 'opening') return false; 
        
        if (!search) return true;
        const content = (item.data.resultText || "").toLowerCase();
        const title = (item.title || "").toLowerCase();
        return title.includes(search) || content.includes(search);
    });
    
    if (filtered.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无草稿</div>'); return; }

    filtered.forEach((item, index) => {
        const previewText = item.data.resultText || '无内容';
        const displayTitle = item.title || "User & Char";

        const $el = $(`
        <div class="pw-history-item">
            <div class="pw-hist-main">
                <div class="pw-hist-header">
                    <span class="pw-hist-title-display">${displayTitle}</span>
                    <input type="text" class="pw-hist-title-input" value="${displayTitle}" style="display:none;">
                    <div style="display:flex; gap:5px;">
                        <i class="fa-solid fa-pen pw-hist-action-btn edit" title="编辑标题"></i>
                        <i class="fa-solid fa-trash pw-hist-action-btn del" data-index="${index}" title="删除"></i>
                    </div>
                </div>
                <div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div>
                <div class="pw-hist-desc">${previewText}</div>
            </div>
        </div>
    `);
        $el.on('click', function (e) {
            if ($(e.target).closest('.pw-hist-action-btn, .pw-hist-title-input').length) return;
            $('#pw-request').val(item.request); $('#pw-result-text').val(previewText); $('#pw-result-area').show();
            $('#pw-request').addClass('minimized');
            $('.pw-tab[data-tab="editor"]').click();
        });
        $el.find('.pw-hist-action-btn.del').on('click', function (e) {
            e.stopPropagation();
            if (confirm("删除?")) {
                historyCache.splice(historyCache.indexOf(item), 1);
                saveData(); renderHistoryList();
            }
        });
        $list.append($el);
    });
};

window.pwExtraBooks = [];
const renderWiBooks = async () => {
    const container = $('#pw-wi-container').empty();
    const baseBooks = await getContextWorldBooks();
    const allBooks = [...new Set([...baseBooks, ...(window.pwExtraBooks || [])])];
    if (allBooks.length === 0) { container.html('<div style="opacity:0.6; padding:10px; text-align:center;">此角色未绑定世界书，请在“世界书”标签页手动添加或在酒馆主界面绑定。</div>'); return; }
    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        const $el = $(`<div class="pw-wi-book"><div class="pw-wi-header"><span><i class="fa-solid fa-book"></i> ${book} ${isBound ? '<span style="color:#9ece6a;font-size:0.8em;margin-left:5px;">(已绑定)</span>' : ''}</span><div>${!isBound ? '<i class="fa-solid fa-times remove-book" style="color:#ff6b6b;margin-right:10px;" title="移除"></i>' : ''}<i class="fa-solid fa-chevron-down arrow"></i></div></div><div class="pw-wi-list" data-book="${book}"></div></div>`);
        $el.find('.remove-book').on('click', (e) => { e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book); renderWiBooks(); });
        $el.find('.pw-wi-header').on('click', async function () {
            const $list = $el.find('.pw-wi-list');
            const $arrow = $(this).find('.arrow');
            if ($list.is(':visible')) { $list.slideUp(); $arrow.removeClass('fa-flip-vertical'); }
            else {
                $list.slideDown(); $arrow.addClass('fa-flip-vertical');
                if (!$list.data('loaded')) {
                    $list.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                    const entries = await getWorldBookEntries(book);
                    $list.empty();
                    if (entries.length === 0) $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>');
                    entries.forEach(entry => {
                        const isChecked = entry.enabled ? 'checked' : '';
                        const $item = $(`<div class="pw-wi-item"><div class="pw-wi-item-row"><input type="checkbox" class="pw-wi-check" ${isChecked} data-content="${encodeURIComponent(entry.content)}"><div style="font-weight:bold; font-size:0.9em; flex:1;">${entry.displayName}</div><i class="fa-solid fa-eye pw-wi-toggle-icon"></i></div><div class="pw-wi-desc">${entry.content}<div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div></div></div>`);
                        $item.find('.pw-wi-toggle-icon').on('click', function (e) {
                            e.stopPropagation();
                            const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc');
                            if ($desc.is(':visible')) { $desc.slideUp(); $(this).css('color', ''); } else { $desc.slideDown(); $(this).css('color', '#5b8db8'); }
                        });
                        $item.find('.pw-wi-close-bar').on('click', function () { $(this).parent().slideUp(); $item.find('.pw-wi-toggle-icon').css('color', ''); });
                        $list.append($item);
                    });
                    $list.data('loaded', true);
                }
            }
        });
        container.append($el);
    }
};

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
        const container = $('.persona_controls_buttons_block');
        const btn = $(`#${BUTTON_ID}`);
        if (container.length > 0 && btn.length === 0) {
            addPersonaButton();
        }
    }, 2000);
}

jQuery(async () => {
    injectStyles();
    addPersonaButton();
    startPolling();
    bindEvents();
});
