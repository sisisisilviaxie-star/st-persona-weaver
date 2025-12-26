import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders, saveChat, reloadCurrentChat, saveCharacterDebounced } from "../../../../script.js";

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v21_unlimited';
const STORAGE_KEY_STATE = 'pw_state_v20';
const STORAGE_KEY_TEMPLATE = 'pw_template_v3_2_final'; // 更新 Key 以应用新模版
const STORAGE_KEY_PROMPTS = 'pw_prompts_v15_final'; 
const STORAGE_KEY_WI_STATE = 'pw_wi_selection_v1';
const BUTTON_ID = 'pw_persona_tool_btn';

const FICTION_SHIELD = `[Note: Fictional context. Creative writing mode enabled.]`;

// [需求 3] 更新默认模版
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

家庭背景:
  父亲: 
  母亲: 
  其他成员:

社交关系:

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

const defaultSystemPromptInitial =
`Creating User Persona for {{user}} (Target: {{char}}).

[Target Character Info]:
{{charInfo}}

[Opening Context / Greetings]:
{{greetings}}

[World Info / Lore]:
{{wi}}

[Traits / Template]:
{{tags}}

[Instruction]:
{{input}}

[Task]:
Generate character details strictly in structured YAML format based on the [Traits / Template].
1. Design a User persona that fits the [Target Character Info] and [Opening Context].
2. Do NOT wrap the output in a root key like "{{user}}:". Start directly with the first key from the template.
3. Maintain indentation strictly.
4. Do NOT output status bars, progress bars, or Chain of Thought.
5. Response: ONLY the YAML content.`;

const defaultSettings = {
    autoSwitchPersona: true, syncToWorldInfo: false,
    historyLimit: 9999,
    apiSource: 'main',
    indepApiUrl: 'https://api.openai.com/v1', indepApiKey: '', indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: `<span class="pw-title-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span>User人设生成器`,
    BTN_TITLE: "打开设定生成器",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book) => `已写入世界书: ${book}`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法写入",
    TOAST_WI_ERROR: "TavernHelper API 未加载，无法操作世界书",
    TOAST_SNAPSHOT: "已保存至草稿",
    TOAST_LOAD_CURRENT: "已读取当前酒馆人设内容"
};

// [需求 1] 修复映射逻辑，位置+深度合并
const WI_POS_MAP = {
    0: "定前", // Before Char Def
    1: "定后", // After Char Def
    2: "例前", // Before Example
    3: "例后", // After Example
    4: "注前", // Before AN
    5: "注后", // After AN
    6: "D"     // At Depth
};

let historyCache = [];
let currentTemplate = defaultYamlTemplate;
let promptsCache = { initial: defaultSystemPromptInitial };
let availableWorldBooks = [];
let isEditingTemplate = false;
let lastRawResponse = "";
let isProcessing = false;
let currentGreetingsList = []; 
let wiSelectionCache = {};

// ============================================================================
// 工具函数
// ============================================================================
const yieldToBrowser = () => new Promise(resolve => requestAnimationFrame(resolve));
const forcePaint = () => new Promise(resolve => setTimeout(resolve, 50));

function getCharacterInfoText() {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || !context.characters[charId]) return "";

    const char = context.characters[charId];
    const data = char.data || char; 

    const parts = [];
    const MAX_FIELD_LENGTH = 1000000; 

    if (data.description) {
        let desc = data.description;
        if (desc.length > MAX_FIELD_LENGTH) desc = desc.substring(0, MAX_FIELD_LENGTH) + "\n...(truncated)...";
        parts.push(`Description:\n${desc}`);
    }
    
    if (data.personality) {
        let pers = data.personality;
        if (pers.length > MAX_FIELD_LENGTH) pers = pers.substring(0, MAX_FIELD_LENGTH) + "\n...(truncated)...";
        parts.push(`Personality:\n${pers}`);
    }
    
    if (data.scenario) {
        let scen = data.scenario;
        if (scen.length > MAX_FIELD_LENGTH) scen = scen.substring(0, MAX_FIELD_LENGTH) + "\n...(truncated)...";
        parts.push(`Scenario:\n${scen}`);
    }
    
    return parts.join('\n\n');
}

function getCharacterGreetingsList() {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || !context.characters[charId]) return [];

    const char = context.characters[charId];
    const data = char.data || char;

    const list = [];
    if (data.first_mes) {
        list.push({ label: "开场白 #0", content: data.first_mes });
    }
    if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((greeting, index) => {
            list.push({ label: `开场白 #${index + 1}`, content: greeting });
        });
    }
    return list;
}

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

async function collectContextData() {
    let wiContent = [];
    let greetingsContent = "";

    try {
        const boundBooks = await getContextWorldBooks();
        const manualBooks = window.pwExtraBooks || [];
        const allBooks = [...new Set([...boundBooks, ...manualBooks])];
        if (allBooks.length > 20) allBooks.length = 20;

        for (const bookName of allBooks) {
            await yieldToBrowser();
            const $list = $('#pw-wi-container .pw-wi-list[data-book="' + bookName + '"]');
            
            if ($list.length > 0 && $list.data('loaded')) {
                $list.find('.pw-wi-check:checked').each(function() {
                    const content = decodeURIComponent($(this).data('content'));
                    wiContent.push(`[Entry from ${bookName}]:\n${content}`);
                });
            } else {
                try {
                    const savedSelection = loadWiSelection(bookName);
                    const entries = await getWorldBookEntries(bookName);
                    
                    let enabledEntries = [];
                    if (savedSelection && savedSelection.length > 0) {
                        enabledEntries = entries.filter(e => savedSelection.includes(String(e.uid)));
                    } else {
                        enabledEntries = entries.filter(e => e.enabled);
                    }
                    
                    enabledEntries.forEach(entry => {
                        wiContent.push(`[Entry from ${bookName}]:\n${entry.content}`);
                    });
                } catch(err) {
                    console.warn(`[PW] Failed to auto-fetch book ${bookName}`, err);
                }
            }
        }
    } catch (e) { console.warn(e); }

    const selectedIdx = $('#pw-greetings-select').val();
    if (selectedIdx !== "" && selectedIdx !== null && currentGreetingsList[selectedIdx]) {
        greetingsContent = currentGreetingsList[selectedIdx].content;
    }

    return {
        wi: wiContent.join('\n\n'),
        greetings: greetingsContent
    };
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
        let savedInitial = p ? (p.initial || p.main) : null;
        promptsCache = { 
            initial: savedInitial || defaultSystemPromptInitial
        };
    } catch { 
        promptsCache = { initial: defaultSystemPromptInitial }; 
    }
    try {
        wiSelectionCache = JSON.parse(localStorage.getItem(STORAGE_KEY_WI_STATE)) || {};
    } catch { wiSelectionCache = {}; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TEMPLATE, currentTemplate);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(promptsCache));
}

function saveHistory(item) {
    if (!item.title || item.title === "未命名") {
        const context = getContext();
        const userName = $('.persona_name').first().text().trim() || "User";
        const charName = context.characters[context.characterId]?.name || "Char";
        item.title = `${userName} & ${charName}`;
    }
    historyCache.unshift(item);
    saveData();
}

function getWiCacheKey() {
    const context = getContext();
    return context.characterId || 'global_no_char'; 
}

function loadWiSelection(bookName) {
    const charKey = getWiCacheKey();
    if (wiSelectionCache[charKey] && wiSelectionCache[charKey][bookName]) {
        return wiSelectionCache[charKey][bookName]; 
    }
    return null;
}

function saveWiSelection(bookName, uids) {
    const charKey = getWiCacheKey();
    if (!wiSelectionCache[charKey]) wiSelectionCache[charKey] = {};
    wiSelectionCache[charKey][bookName] = uids;
    localStorage.setItem(STORAGE_KEY_WI_STATE, JSON.stringify(wiSelectionCache));
}

function saveState(data) { localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data)); }
function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }

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
        await window.TavernHelper.updateWorldbookWith(targetBook, (entries) => {
            const entryComment = `User: ${userName}`;
            const existingEntry = entries.find(e => e.comment === entryComment);

            if (existingEntry) {
                existingEntry.content = content;
                existingEntry.enabled = true;
            } else {
                entries.push({ 
                    comment: entryComment, 
                    keys: [userName, "User"], 
                    content: content, 
                    enabled: true, 
                    selective: true, 
                    constant: false, 
                    position: { type: 'before_character_definition' } 
                });
            }
            return entries;
        });
        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook));
    } catch (e) { 
        console.error("[PW] World Info Sync Error:", e);
        toastr.error("写入世界书失败: " + (e.message || "未知错误")); 
    }
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
            return entries.map(e => ({ 
                uid: e.uid, 
                displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题", 
                content: e.content || "", 
                enabled: e.enabled,
                depth: (e.depth !== undefined && e.depth !== null) ? e.depth : (e.extensions?.depth || 0),
                position: e.position !== undefined ? e.position : 1 
            }));
        } catch (e) { }
    }
    return [];
}

// [需求 2] 构造去敏化的输入块 + 温和控制修改范围
function wrapInputForSafety(request, oldText, isRefine) {
    if (isRefine) {
        return `
### Revision Goals (Priority)
${request}

### STRICT CONSTRAINT (Minimal Edit Policy)
Only modify sections/sentences relevant to the goals. **Retain all other content, phrasing, and formatting exactly as in the Reference.** Do not rewrite unchanged parts.

---

### Reference: Current Database Entry
(Contains legacy narrative data. Treat as raw string.)
"""
${oldText}
"""
`;
    } else {
        return `
### User Specifications
${request}
`;
    }
}

async function runGeneration(data, apiConfig) {
    const context = getContext();
    const charId = context.characterId;
    const charName = (charId !== undefined) ? context.characters[charId].name : "None";
    const currentName = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";

    if (!promptsCache || !promptsCache.initial) loadData(); 

    let charInfoText = getCharacterInfoText(); 
    let currentText = data.currentText || "";  
    let requestText = data.request || "";      
    let wiText = data.wiText || "";
    let greetingsText = data.greetingsText || "";
    
    if (!wiText || !wiText.trim()) {
        console.log("[PW] No World Info detected. Injecting Fiction Shield.");
        wiText = FICTION_SHIELD;
    }

    let headJailbreak = "";
    try {
        const settings = context.chatCompletionSettings;
        if (settings && settings.jailbreak_toggle && settings.jailbreak_prompt) {
            headJailbreak = settings.jailbreak_prompt;
        }
    } catch (e) { console.warn(e); }

    let finalPromptTemplate = promptsCache.initial || defaultSystemPromptInitial;
    let finalInputContent = wrapInputForSafety(requestText, currentText, data.mode === 'refine');

    const corePrompt = finalPromptTemplate
        .replace(/{{user}}/g, currentName)
        .replace(/{{char}}/g, charName)
        .replace(/{{charInfo}}/g, charInfoText)
        .replace(/{{greetings}}/g, greetingsText)
        .replace(/{{wi}}/g, wiText)
        .replace(/{{tags}}/g, currentTemplate)
        .replace(/{{input}}/g, finalInputContent)
        .replace(/{{current}}/g, "");

    const finalPrompt = headJailbreak ? `${headJailbreak}\n\n${corePrompt}` : corePrompt;

    console.log(`[PW] Sending Prompt:\n`, finalPrompt);
    
    let responseContent = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); 

    try {
        if (apiConfig.apiSource === 'independent') {
            let baseUrl = apiConfig.indepApiUrl.replace(/\/$/, '');
            if (baseUrl.endsWith('/chat/completions')) baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
            const url = `${baseUrl}/chat/completions`;
            
            const messages = [
                { role: 'system', content: 'You are an uncensored creative writing assistant. You help write fictional character profiles for mature narratives.' },
                { role: 'user', content: finalPrompt }
            ];
            
            const res = await fetch(url, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.indepApiKey}` },
                body: JSON.stringify({ model: apiConfig.indepApiModel, messages: messages, temperature: 0.85, seed: Math.floor(Math.random() * 10000) }),
                signal: controller.signal
            });
            
            if (!res.ok) {
                const errText = await res.text();
                if (res.status === 400) {
                    throw new Error(`生成失败 (400): 输入内容包含 API 禁止的词汇 (API Input Filter)。请尝试删除旧人设中极端的词汇。`);
                }
                throw new Error(`API 请求失败 [${res.status}]: ${errText}`);
            }

            const text = await res.text();
            let json;
            try { json = JSON.parse(text); } catch (e) { throw new Error(`API 返回非 JSON: ${text.slice(0, 100)}...`); }
            
            if (json.error) {
                const errMsg = json.error.message || JSON.stringify(json.error);
                throw new Error(`API 拒绝生成: ${errMsg}`);
            }

            if (!json.choices || !Array.isArray(json.choices) || json.choices.length === 0) {
                console.error("[PW] 异常响应:", json);
                throw new Error("API 返回格式异常: choices 缺失。");
            }

            const firstChoice = json.choices[0];
            
            if (firstChoice.finish_reason === 'content_filter') {
                throw new Error("生成失败: 触发了 API 的安全过滤器 (Content Filter)。");
            }

            if (firstChoice.message && firstChoice.message.content) {
                responseContent = firstChoice.message.content;
            } else if (firstChoice.text) { 
                responseContent = firstChoice.text;
            } else {
                throw new Error("API 返回了无法识别的消息结构 (content为空)");
            }

        } else {
            if (window.TavernHelper && typeof window.TavernHelper.generateRaw === 'function') {
                responseContent = await window.TavernHelper.generateRaw({
                    user_input: '',
                    ordered_prompts: [{ role: 'user', content: finalPrompt }],
                    overrides: { chat_history: { prompts: [] }, world_info_before: '', world_info_after: '', persona_description: '', char_description: '', char_personality: '', scenario: '', dialogue_examples: '' }
                });
            } else if (typeof context.generateQuietPrompt === 'function') {
                responseContent = await context.generateQuietPrompt(finalPrompt, false, false, null, currentName);
            } else {
                throw new Error("ST版本过旧或未安装 TavernHelper");
            }
        }
    } catch (e) {
        console.error("[PW] 生成错误:", e);
        throw e;
    } finally { 
        clearTimeout(timeoutId); 
    }
    
    if (responseContent.length < 150 && (responseContent.includes("I cannot") || responseContent.includes("I can't") || responseContent.includes("unable to"))) {
        throw new Error(`模型拒绝生成: ${responseContent}`);
    }

    if (!responseContent || !responseContent.trim()) {
        throw new Error("生成结果为空 (模型未返回任何文本)");
    }

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

    const forcedStyles = `
    <style>
        /* === Tab Bar Visibility === */
        .pw-diff-tabs-bar {
            border-bottom: 1px solid #444;
        }
        .pw-diff-tab {
            color: #ccc !important;
            background: rgba(0,0,0,0.3) !important;
        }
        .pw-diff-tab.active {
            color: #fff !important;
            border-bottom: 2px solid #83c168; 
            background: rgba(0,0,0,0.5) !important;
        }
        .pw-tab-sub {
            color: #999 !important; 
        }

        /* === Buttons Visibility === */
        #pw-diff-confirm {
            background: transparent !important;
            border: 1px solid #83c168 !important;
            color: #83c168 !important;
            text-shadow: none !important;
            opacity: 1 !important;
        }
        #pw-diff-confirm:hover {
            background: rgba(131, 193, 104, 0.1) !important;
        }

        #pw-diff-cancel {
            background: transparent !important;
            border: 1px solid #ff6b6b !important;
            color: #ff6b6b !important;
            text-shadow: none !important;
            opacity: 1 !important;
        }
        #pw-diff-cancel:hover {
            background: rgba(255, 107, 107, 0.1) !important;
        }

        /* === List View Styles === */
        .pw-diff-card {
            background-color: transparent !important;
            border-radius: 8px;
            padding: 0 !important;
            margin-bottom: 12px;
            border: 1px solid #666 !important;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transition: all 0.2s ease;
        }

        .pw-diff-card.selected {
            border-color: #83c168 !important;
            box-shadow: 0 0 10px rgba(131, 193, 104, 0.2); 
        }

        .pw-diff-label {
            text-align: center;
            font-weight: bold;
            font-size: 0.9em;
            letter-spacing: 1px;
            padding: 5px 0;
            margin: 0 !important;
            width: 100%;
            background-color: rgba(255,255,255,0.05);
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .pw-diff-card.selected .pw-diff-label {
            color: #83c168 !important;
            background-color: rgba(131, 193, 104, 0.1) !important;
            border-bottom: 1px solid rgba(131, 193, 104, 0.2);
        }
        .pw-diff-card .pw-diff-label {
            color: #aaa !important;
        }

        .pw-diff-textarea {
            background: transparent !important;
            border: none !important;
            width: 100%;
            resize: none;
            outline: none;
            font-family: inherit;
            line-height: 1.6;
            font-size: 1em;
            display: block;
            color: #ffffff !important; 
            padding: 10px;
        }

        .pw-diff-raw-textarea {
            color: #ffffff !important;
            background: rgba(0,0,0,0.2) !important;
        }

        .pw-diff-attr-name {
            color: #ffffff !important;
            text-align: center;
            font-weight: bold;
            font-size: 1.1em;
            margin: 15px 0 10px 0;
            border-bottom: 1px solid #555; 
            padding-bottom: 5px;
        }
        
        .pw-wi-header-checkbox { 
            margin-right: 10px; 
            cursor: pointer; 
            transform: scale(1.2);
        }

        .pw-wi-depth-tools {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(0,0,0,0.1);
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            font-size: 0.85em;
            flex-wrap: wrap;
        }
        .pw-depth-input {
            width: 40px;
            padding: 2px 4px;
            background: var(--SmartThemeInputBg);
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeInputColor);
            border-radius: 4px;
            text-align: center;
        }
        .pw-pos-select {
            padding: 2px 4px;
            background: var(--SmartThemeInputBg);
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeInputColor);
            border-radius: 4px;
            max-width: 120px;
        }
        .pw-depth-btn {
            padding: 2px 8px;
            background: var(--SmartThemeBtnBg);
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeBtnText);
            border-radius: 4px;
            cursor: pointer;
        }
        .pw-depth-btn:hover { 
            filter: brightness(1.1); 
        }
        .pw-wi-info-badge {
            font-size: 0.75em;
            background: rgba(255,255,255,0.1);
            padding: 1px 4px;
            border-radius: 3px;
            color: #aaa;
            margin-right: 5px;
        }
    </style>
    `;

    const html = `
${forcedStyles}
<div class="pw-wrapper">
    <div class="pw-header">
        <div class="pw-top-bar"><div class="pw-title">${headerTitle}</div></div>
        <div class="pw-tabs">
            <div class="pw-tab active" data-tab="editor">人设</div>
            <div class="pw-tab" data-tab="context">参考</div> 
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
                    <span class="pw-tags-label">
                        模版块 (点击填入) 
                        <i class="fa-solid fa-angle-up" id="pw-toggle-chips-vis" style="margin-left:5px; cursor:pointer;" title="折叠/展开"></i>
                    </span>
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
                        <div style="display:flex; gap:5px;">
                            <button class="pw-mini-btn" id="pw-restore-template" title="恢复为含家庭/社交的默认模版">恢复默认</button>
                            <button class="pw-mini-btn" id="pw-save-template">保存模版</button>
                        </div>
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

    <!-- Diff Overlay -->
    <div id="pw-diff-overlay" class="pw-diff-container" style="display:none;">
        <div class="pw-diff-tabs-bar">
            <div class="pw-diff-tab active" data-view="diff">
                <div>智能对比</div><div class="pw-tab-sub">选择编辑</div>
            </div>
            <div class="pw-diff-tab" data-view="raw">
                <div>新版原文</div><div class="pw-tab-sub">查看/编辑</div>
            </div>
            <div class="pw-diff-tab" data-view="old-raw">
                <div>原版原文</div><div class="pw-tab-sub">查看/编辑</div>
            </div>
        </div>
        
        <div class="pw-diff-content-area">
            <div id="pw-diff-list-view" class="pw-diff-list-view">
                <div id="pw-diff-list" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
            <div id="pw-diff-raw-view" class="pw-diff-raw-view">
                <textarea id="pw-diff-raw-textarea" class="pw-diff-raw-textarea" spellcheck="false"></textarea>
            </div>
            <div id="pw-diff-old-raw-view" class="pw-diff-raw-view" style="display:none;">
                <textarea id="pw-diff-old-raw-textarea" class="pw-diff-raw-textarea" spellcheck="false"></textarea>
            </div>
        </div>

        <div class="pw-diff-actions">
            <button class="pw-btn danger" id="pw-diff-cancel">放弃修改</button>
            <button class="pw-btn save" id="pw-diff-confirm">保存并应用</button>
        </div>
    </div>

    <div id="pw-float-quote-btn" class="pw-float-quote-btn"><i class="fa-solid fa-pen-to-square"></i> 修改此段</div>

    <!-- Context View -->
    <div id="pw-view-context" class="pw-view">
        <div class="pw-scroll-area">
            <div class="pw-card-section">
                <div class="pw-row">
                    <label class="pw-section-label pw-label-gold">角色开场白</label>
                    <select id="pw-greetings-select" class="pw-input" style="flex:1; max-width:60%;">
                        <option value="">(不使用开场白)</option>
                    </select>
                </div>
                <div id="pw-greetings-toggle-bar" class="pw-preview-toggle-bar" style="display:none;">
                    <i class="fa-solid fa-angle-up"></i> 收起预览
                </div>
                <textarea id="pw-greetings-preview"></textarea>
            </div>

            <div class="pw-card-section">
                <div class="pw-row" style="margin-bottom:5px;">
                    <label class="pw-section-label pw-label-blue">世界书</label>
                </div>
                <div id="pw-wi-body" style="display:block; padding-top:5px;">
                    <div class="pw-wi-controls" style="margin-bottom:8px;">
                        <select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">-- 添加参考/目标世界书 --</option>${renderBookOptions()}</select>
                        <button id="pw-wi-refresh" class="pw-btn primary pw-wi-refresh-btn"><i class="fa-solid fa-sync"></i></button>
                        <button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div id="pw-wi-container"></div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- API View -->
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

            <div class="pw-card-section">
                <div class="pw-context-header" id="pw-prompt-header">
                    <span><i class="fa-solid fa-terminal"></i> Prompt 查看与编辑</span>
                    <i class="fa-solid fa-chevron-down arrow"></i>
                </div>
                <div id="pw-prompt-container" style="display:none; padding-top:10px;">
                    <div style="display:flex; justify-content:space-between;"><span class="pw-prompt-label">人设生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-initial" style="font-size:0.7em;">恢复默认</button></div>
                    <div class="pw-var-btns">
                        <div class="pw-var-btn" data-ins="{{user}}"><span>User名</span><span class="code">{{user}}</span></div>
                        <div class="pw-var-btn" data-ins="{{char}}"><span>Char名</span><span class="code">{{char}}</span></div>
                        <div class="pw-var-btn" data-ins="{{charInfo}}"><span>角色设定</span><span class="code">{{charInfo}}</span></div>
                        <div class="pw-var-btn" data-ins="{{greetings}}"><span>开场白</span><span class="code">{{greetings}}</span></div>
                        <div class="pw-var-btn" data-ins="{{tags}}"><span>模版内容</span><span class="code">{{tags}}</span></div>
                        <div class="pw-var-btn" data-ins="{{input}}"><span>用户要求</span><span class="code">{{input}}</span></div>
                        <div class="pw-var-btn" data-ins="{{wi}}"><span>世界书内容</span><span class="code">{{wi}}</span></div>
                    </div>
                    <textarea id="pw-prompt-initial" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.initial}</textarea>
                    
                    <div style="text-align:right; margin-top:5px;"><button id="pw-api-save" class="pw-btn primary" style="width:100%;">保存 Prompt</button></div>
                </div>
            </div>
        </div>
    </div>

    <div id="pw-view-history" class="pw-view"><div class="pw-scroll-area"><div class="pw-search-box"><i class="fa-solid fa-search pw-search-icon"></i><input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="搜索历史..."><i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i></div><div id="pw-history-list" style="display:flex; flex-direction:column;"></div><button id="pw-history-clear-all" class="pw-btn">清空所有草稿</button></div></div>
</div>
`;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "关闭" });

    renderTemplateChips();
    renderWiBooks();
    renderGreetingsList(); 
    
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

    console.log("[PW] Binding Events (Standard)...");

    const context = getContext();
    if (context && context.eventSource) {
        context.eventSource.on(context.eventTypes.APP_READY, addPersonaButton);
        context.eventSource.on(context.eventTypes.MOVABLE_PANELS_RESET, addPersonaButton);
    }
    window.openPersonaWeaver = openCreatorPopup;

    // --- Header Toggles (Prompt) ---
    $(document).on('click.pw', '#pw-prompt-header', function() {
        const $body = $('#pw-prompt-container');
        const $arrow = $(this).find('.arrow');
        if ($body.is(':visible')) { $body.slideUp(); $arrow.removeClass('fa-flip-vertical'); }
        else { $body.slideDown(); $arrow.addClass('fa-flip-vertical'); }
    });

    // --- Greetings Select Handling ---
    $(document).on('change.pw', '#pw-greetings-select', function() {
        const idx = $(this).val();
        const $preview = $('#pw-greetings-preview');
        const $toggleBtn = $('#pw-greetings-toggle-bar');
        
        if (idx === "") {
            $preview.hide();
            $toggleBtn.hide();
        } else if (currentGreetingsList[idx]) {
            $preview.val(currentGreetingsList[idx].content).show();
            $toggleBtn.show().html('<i class="fa-solid fa-angle-up"></i> 收起预览');
            requestAnimationFrame(() => {
                $preview.height('auto');
                $preview.height($preview[0].scrollHeight + 'px');
            });
        }
    });

    $(document).on('click.pw', '#pw-greetings-toggle-bar', function() {
        const $preview = $('#pw-greetings-preview');
        if ($preview.is(':visible')) {
            $preview.slideUp();
            $(this).html('<i class="fa-solid fa-angle-down"></i> 展开预览');
        } else {
            $preview.slideDown();
            $(this).html('<i class="fa-solid fa-angle-up"></i> 收起预览');
        }
    });

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
            $('#pw-toggle-edit-template').text("取消编辑").addClass('editing');
            $('#pw-toggle-chips-vis').hide(); // Hide toggle when editing
        } else {
            $('#pw-template-editor').hide();
            $('#pw-template-chips').css('display', 'flex');
            $('#pw-toggle-edit-template').text("编辑模版").removeClass('editing');
            $('#pw-toggle-chips-vis').show();
        }
    });

    // [需求] 模版块折叠事件
    $(document).on('click.pw', '#pw-toggle-chips-vis', function() {
        const $chips = $('#pw-template-chips');
        if ($chips.is(':visible')) {
            $chips.slideUp();
            $(this).removeClass('fa-angle-up').addClass('fa-angle-down');
        } else {
            $chips.slideDown().css('display', 'flex');
            $(this).removeClass('fa-angle-down').addClass('fa-angle-up');
        }
    });

    // [需求] 恢复默认模版事件
    $(document).on('click.pw', '#pw-restore-template', function() {
        if(confirm("确定要恢复默认模版吗？当前未保存的修改将丢失。")) {
            $('#pw-template-text').val(defaultYamlTemplate);
            toastr.success("已恢复默认模版，请点击'保存模版'以应用。");
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
        $('#pw-toggle-edit-template').text("编辑模版").removeClass('editing');
        $('#pw-toggle-chips-vis').show();
        toastr.success("模版已更新");
    });

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
        e.preventDefault(); e.stopPropagation();
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
        
        // Hide all
        $('#pw-diff-list-view, #pw-diff-raw-view, #pw-diff-old-raw-view').hide();

        if (view === 'diff') { 
            $('#pw-diff-list-view').show();
        } else if (view === 'raw') { 
            $('#pw-diff-raw-view').show();
        } else if (view === 'old-raw') {
            $('#pw-diff-old-raw-view').show();
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
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'refine', 
                request: refineReq, 
                currentText: oldText, 
                wiText: contextData.wi,           
                greetingsText: contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const responseText = await runGeneration(config, config);

            // 填充新版和旧版 raw view
            $('#pw-diff-raw-textarea').val(lastRawResponse);
            $('#pw-diff-old-raw-textarea').val(oldText);

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
            $('.pw-diff-tab[data-view="raw"] .pw-tab-sub').text('查看/编辑');
            $('.pw-diff-tab[data-view="old-raw"] div:first-child').text('原版原文');
            $('.pw-diff-tab[data-view="old-raw"] .pw-tab-sub').text('查看/编辑');

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
        } else if (activeTab === 'old-raw') {
            finalContent = $('#pw-diff-old-raw-textarea').val();
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
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'initial', 
                request: req, 
                wiText: contextData.wi,
                greetingsText: contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const text = await runGeneration(config, config);
            $('#pw-result-text').val(text);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        } catch (e) { 
            console.error(e);
            toastr.error(e.message); 
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
        saveData();
        toastr.success("设置与Prompt已保存");
    });

    $(document).on('click.pw', '#pw-reset-initial', () => {
        if (confirm("恢复初始生成Prompt？")) $('#pw-prompt-initial').val(defaultSystemPromptInitial);
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
    
    if (allBooks.length === 0) { 
        container.html('<div style="opacity:0.6; padding:10px; text-align:center;">此角色未绑定世界书，请在“世界书”标签页手动添加或在酒馆主界面绑定。</div>'); 
        return; 
    }

    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        
        const $el = $(`
        <div class="pw-wi-book">
            <div class="pw-wi-header" style="display:flex; align-items:center;">
                <input type="checkbox" class="pw-wi-header-checkbox pw-wi-select-all" title="全选/全不选">
                <span style="flex:1; display:flex; align-items:center;">
                    <i class="fa-solid fa-book" style="margin-right:5px;"></i> ${book} ${isBound ? '<span class="pw-bound-status" style="margin-left:5px;">(已绑定)</span>' : ''}
                </span>
                <div>${!isBound ? '<i class="fa-solid fa-times remove-book pw-remove-book-icon" title="移除"></i>' : ''}<i class="fa-solid fa-chevron-down arrow"></i></div>
            </div>
            <div class="pw-wi-list" data-book="${book}"></div>
        </div>`);
        
        // 全选事件：同步更新缓存
        $el.find('.pw-wi-select-all').on('click', async function(e) {
            e.stopPropagation();
            const checked = $(this).prop('checked');
            const $list = $el.find('.pw-wi-list');
            
            const doCheck = () => {
                $el.find('.pw-wi-check').prop('checked', checked);
                // 保存状态
                const checkedUids = [];
                $el.find('.pw-wi-check:checked').each(function() { checkedUids.push($(this).val()); });
                saveWiSelection(book, checkedUids);
            };

            if (!$list.is(':visible') && !$list.data('loaded')) {
                // 如果未加载，先展开加载数据
                $el.find('.pw-wi-header').click(); 
                // 等待渲染
                setTimeout(doCheck, 150);
            } else {
                doCheck();
            }
        });

        $el.find('.remove-book').on('click', (e) => { e.stopPropagation(); window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book); renderWiBooks(); });
        
        // 展开/折叠逻辑
        $el.find('.pw-wi-header').on('click', async function (e) {
            if ($(e.target).hasClass('pw-wi-header-checkbox')) return; // 防止点checkbox触发折叠

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
                    
                    if (entries.length === 0) {
                        $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>');
                    } else {
                        // [需求 1] 深度+位置工具栏
                        const $tools = $(`
                        <div class="pw-wi-depth-tools">
                            <span style="opacity:0.7">筛选:</span>
                            <span style="font-size:0.8em; opacity:0.6; margin-left:5px;">深度</span>
                            <input type="number" class="pw-depth-input" id="d-min" placeholder="0" value="0">
                            <span>-</span>
                            <input type="number" class="pw-depth-input" id="d-max" placeholder="Max" value="">
                            
                            <span style="font-size:0.8em; opacity:0.6; margin-left:5px;">位置</span>
                            <select class="pw-pos-select" id="p-select">
                                <option value="-1">全部</option>
                                <option value="0">角色定义前</option>
                                <option value="1">角色定义后</option>
                                <option value="2">样例消息前</option>
                                <option value="3">样例消息后</option>
                                <option value="4">作者注释前</option>
                                <option value="5">作者注释后</option>
                                <option value="6">指定深度</option>
                            </select>

                            <div style="flex:1; display:flex; justify-content:flex-end; gap:5px; margin-top:5px;">
                                <button class="pw-depth-btn" id="d-apply" title="选中范围内的条目">选中</button>
                                <button class="pw-depth-btn" id="d-clear" title="清空所有选择">清空</button>
                                <button class="pw-depth-btn" id="d-reset" title="恢复为世界书原始状态">重置</button>
                            </div>
                        </div>`);
                        
                        $tools.find('#d-apply').on('click', function() {
                            const dMin = parseInt($tools.find('#d-min').val()) || 0;
                            const dMaxStr = $tools.find('#d-max').val();
                            const dMax = dMaxStr === "" ? 99999 : parseInt(dMaxStr);
                            const pVal = parseInt($tools.find('#p-select').val());

                            $list.find('.pw-wi-item').each(function() {
                                const d = $(this).data('depth');
                                const p = $(this).data('position');
                                
                                const depthMatch = d >= dMin && d <= dMax;
                                const posMatch = (pVal === -1) || (p === pVal);

                                if (depthMatch && posMatch) {
                                    $(this).find('.pw-wi-check').prop('checked', true).trigger('change');
                                }
                            });
                        });
                        
                        $tools.find('#d-clear').on('click', function() {
                            $list.find('.pw-wi-check').prop('checked', false).trigger('change');
                        });

                        $tools.find('#d-reset').on('click', function() {
                             $list.find('.pw-wi-item').each(function() {
                                 const originalEnabled = $(this).data('original-enabled');
                                 $(this).find('.pw-wi-check').prop('checked', originalEnabled).trigger('change');
                             });
                             toastr.info("已重置为世界书原始状态");
                        });

                        $list.append($tools);

                        // 读取记忆的选中状态
                        const savedSelection = loadWiSelection(book);

                        entries.forEach(entry => {
                            let isChecked = false;
                            if (savedSelection) {
                                isChecked = savedSelection.includes(String(entry.uid));
                            } else {
                                isChecked = entry.enabled;
                            }
                            
                            const checkedAttr = isChecked ? 'checked' : '';
                            
                            // [需求 1] 合并位置和深度显示
                            const posShort = WI_POS_MAP[entry.position] || "未知";
                            let infoLabel = "";
                            if (entry.position === 6) { // At Depth
                                infoLabel = `<span class="pw-wi-info-badge" title="位置: 指定深度">[D:${entry.depth}]</span>`;
                            } else {
                                infoLabel = `<span class="pw-wi-info-badge" title="位置: ${posShort}, 深度: ${entry.depth}">[${posShort}:${entry.depth}]</span>`;
                            }

                            const $item = $(`
                            <div class="pw-wi-item" data-depth="${entry.depth}" data-position="${entry.position}" data-original-enabled="${entry.enabled}">
                                <div class="pw-wi-item-row">
                                    <input type="checkbox" class="pw-wi-check" value="${entry.uid}" ${checkedAttr} data-content="${encodeURIComponent(entry.content)}">
                                    <div style="font-weight:bold; font-size:0.9em; flex:1; display:flex; align-items:center;">
                                        ${infoLabel} ${entry.displayName}
                                    </div>
                                    <i class="fa-solid fa-eye pw-wi-toggle-icon"></i>
                                </div>
                                <div class="pw-wi-desc">
                                    ${entry.content}
                                    <div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div>
                                </div>
                            </div>`);
                            
                            // 单个勾选变更事件
                            $item.find('.pw-wi-check').on('change', function() {
                                const checkedUids = [];
                                $list.find('.pw-wi-check:checked').each(function() { checkedUids.push($(this).val()); });
                                saveWiSelection(book, checkedUids);
                            });

                            $item.find('.pw-wi-toggle-icon').on('click', function (e) {
                                e.stopPropagation();
                                const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc');
                                if ($desc.is(':visible')) { $desc.slideUp(); $(this).removeClass('active'); } else { $desc.slideDown(); $(this).addClass('active'); }
                            });
                            $item.find('.pw-wi-close-bar').on('click', function () { $(this).parent().slideUp(); $item.find('.pw-wi-toggle-icon').removeClass('active'); });
                            $list.append($item);
                        });
                    }
                    $list.data('loaded', true);
                }
            }
        });
        container.append($el);
    }
};

const renderGreetingsList = () => {
    const list = getCharacterGreetingsList();
    currentGreetingsList = list;
    const $select = $('#pw-greetings-select').empty();
    $select.append('<option value="">(不使用开场白)</option>');
    list.forEach((item, idx) => {
        $select.append(`<option value="${idx}">${item.label}</option>`);
    });
};

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

jQuery(async () => {
    addPersonaButton(); 
    bindEvents(); 
    console.log("[PW] Persona Weaver Loaded (v7.3 - Final Refinement & WI Fixes)");
});
