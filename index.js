import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders, saveChat, reloadCurrentChat, saveCharacterDebounced } from "../../../../script.js";

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v20';
const STORAGE_KEY_STATE = 'pw_state_v20';
const STORAGE_KEY_TEMPLATE = 'pw_template_v2';
const STORAGE_KEY_PROMPTS = 'pw_prompts_v8'; // Bumped version for opening prompts
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

const defaultSystemPromptRefine =
`You are an expert Data Converter and Persona Editor.
Optimizing User Persona for {{char}}.

[Target Character Info]:
{{charInfo}}

[Opening Context / Greetings]:
{{greetings}}

[Target Schema / Template]:
{{tags}}

[Current Data]:
"""
{{current}}
"""

[Instruction]:
"{{input}}"

[Task]:
1. Parse [Current Data]. MIGRATE it to fit the [Target Schema].
2. Apply the [Instruction] to modify or refine the content.
3. Ensure the persona fits the [Target Character Info].
4. STRICTLY output in valid YAML format.
5. Response: ONLY the final YAML content.`;

// [New] Opening Prompts
const defaultSystemPromptOpening =
`Generate distinct opening scenes (First Messages) based on the following personas and context.

[User Persona]:
{{userPersona}}

[Character Persona ({{char}})]:
{{charPersona}}

{{wi}}

[Additional Requirements]:
{{input}}

[Guidelines]:
1. Language: Simplified Chinese.
2. Length: Approx 600-800 characters per option.
3. Content: detailed scene setting, environment description, specific date/time/location.
4. Character: Reflect {{char}}'s personality and traits vividly.
5. Interaction: End with a natural hook for {{user}} to respond. Do NOT summarize or use "elevated" philosophical endings (禁止升华).
6. Constraint: Do NOT speak for {{user}} or decide {{user}}'s actions.
7. Variety: Each option must have a completely different theme, time, scene, and plot.
8. **IMPORTANT**: You MUST use Markdown Code Blocks for the content.

[Output Format]:
Strictly follow this format for each option (generate 3-4 options):

--- Option 1 ---
\`\`\`
[Content of Option 1]
\`\`\`

--- Option 2 ---
\`\`\`
[Content of Option 2]
\`\`\`
...
`;

const defaultSystemPromptOpeningRefine =
`Refine the following Opening Scene (First Message).

[User Persona]:
{{userPersona}}

[Character Persona ({{char}})]:
{{charPersona}}

{{wi}}

[Current Opening Scene]:
"""
{{current}}
"""

[Refinement Instruction]:
"{{input}}"

[Guidelines]:
1. Keep the language Simplified Chinese.
2. Maintain the roleplay style and character voice.
3. Apply the instruction to modify the scene, tone, or details.
4. Do NOT speak for {{user}}.
5. Do NOT output status bars or Chain of Thought.
6. Response: ONLY the refined opening text (do not use markdown code blocks or titles here, just the raw text).`;

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
    refine: defaultSystemPromptRefine,
    opening: defaultSystemPromptOpening,
    openingRefine: defaultSystemPromptOpeningRefine 
};
let availableWorldBooks = [];
let isEditingTemplate = false;
let lastRawResponse = "";
let isProcessing = false;
let currentGreetingsList = []; 
// Carousel State
let currentSlideIndex = 0;
let totalSlides = 0;
let currentRefiningCard = null;

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
    if (data.description) parts.push(`Description:\n${data.description}`);
    if (data.personality) parts.push(`Personality:\n${data.personality}`);
    if (data.scenario) parts.push(`Scenario:\n${data.scenario}`);
    
    return parts.join('\n\n');
}

// [New] More detailed char info for Opening Generation
function getCharacterPersonaString() {
    const context = getContext();
    if (!context.characterId && context.characterId !== 0) return "No Character Selected";
    const char = context.characters[context.characterId];
    let parts = [];
    if (char.name) parts.push(`Name: ${char.name}`);
    if (char.description) parts.push(`Description:\n${char.description}`);
    if (char.personality) parts.push(`Personality:\n${char.personality}`);
    if (char.scenario) parts.push(`Scenario:\n${char.scenario}`);
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

// [New] Carousel Logic
function updateCarousel() {
    if (totalSlides === 0) return;
    const offset = -currentSlideIndex * 100;
    $('#pw-carousel-track').css('transform', `translateX(${offset}%)`);
    $('#pw-slide-indicator').text(`${currentSlideIndex + 1} / ${totalSlides}`);
    $('#pw-prev-slide').prop('disabled', currentSlideIndex === 0);
    $('#pw-next-slide').prop('disabled', currentSlideIndex === totalSlides - 1);
}

function renderOpeningResults(rawText) {
    const $container = $('#pw-opening-results').empty();
    
    // Parse response for code blocks or separators
    let matches = [...rawText.matchAll(/```[\s\S]*?```/g)].map(m => m[0].replace(/```[a-z]*\n?/g, '').replace(/```$/, ''));
    if (!matches || matches.length === 0) {
        if (rawText.includes('---')) {
            matches = rawText.split(/---+[^\n]*---+/g).map(s => s.trim()).filter(s => s.length > 10);
        }
    }
    if (!matches || matches.length === 0) {
        matches = [rawText.trim()];
    }
    
    let slidesHtml = '';
    totalSlides = matches.length;
    
    matches.forEach((content, i) => {
        slidesHtml += `
            <div class="pw-opening-card" data-index="${i}">
                <div class="pw-opening-header">
                    <span>开场白选项 ${i + 1}</span>
                </div>
                <textarea class="pw-opening-textarea">${content.trim()}</textarea>
                
                <div class="pw-card-refine-box">
                    <textarea class="pw-card-refine-input" placeholder="对此开场白提出修改意见..."></textarea>
                    <div style="text-align:right;">
                        <button class="pw-btn save refine-confirm-btn"><i class="fa-solid fa-magic"></i> 确认润色</button>
                    </div>
                </div>

                <div class="pw-opening-actions">
                    <div class="pw-footer-group">
                        <div class="pw-compact-btn pw-copy-opening-btn" title="复制内容"><i class="fa-solid fa-copy"></i></div>
                        <div class="pw-compact-btn pw-save-draft-btn" title="保存"><i class="fa-solid fa-save"></i></div>
                    </div>
                    <div class="pw-footer-group" style="flex:1; justify-content:flex-end; gap: 8px;">
                        <button class="pw-btn toggle-refine-btn" style="background:rgba(255,255,255,0.1); border-color:var(--SmartThemeBorderColor); color:var(--smart-theme-body-color);"><i class="fa-solid fa-pen-fancy"></i> 润色</button>
                        <button class="pw-btn save apply-btn"><i class="fa-solid fa-plus-circle"></i> 加入开场白列表</button>
                    </div>
                </div>
            </div>
        `;
    });

    const carouselHtml = `
        <div class="pw-carousel-container">
            <div id="pw-carousel-track" class="pw-carousel-track">
                ${slidesHtml}
            </div>
        </div>
        <div class="pw-carousel-nav">
            <button id="pw-prev-slide" class="pw-nav-btn"><i class="fa-solid fa-chevron-left"></i></button>
            <span id="pw-slide-indicator" class="pw-slide-indicator">1 / ${totalSlides}</span>
            <button id="pw-next-slide" class="pw-nav-btn"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
    `;
    
    $container.html(carouselHtml);
    currentSlideIndex = 0;
    updateCarousel();
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

    // 1. 收集世界书
    try {
        const boundBooks = await getContextWorldBooks();
        const manualBooks = window.pwExtraBooks || [];
        const allBooks = [...new Set([...boundBooks, ...manualBooks])];
        if (allBooks.length > 20) allBooks.length = 20;

        for (const bookName of allBooks) {
            await yieldToBrowser();
            try {
                $('#pw-wi-container .pw-wi-list[data-book="' + bookName + '"] .pw-wi-check:checked').each(function() {
                    const content = decodeURIComponent($(this).data('content'));
                    wiContent.push(`[Entry from ${bookName}]:\n${content}`);
                });
            } catch (err) { }
        }
    } catch (e) { console.warn(e); }

    // 2. 收集开场白
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
        promptsCache = { 
            ...{ initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine, opening: defaultSystemPromptOpening, openingRefine: defaultSystemPromptOpeningRefine }, 
            ...p 
        };
        // Ensure new keys exist
        if (!promptsCache.opening) promptsCache.opening = defaultSystemPromptOpening;
        if (!promptsCache.openingRefine) promptsCache.openingRefine = defaultSystemPromptOpeningRefine;
    } catch { 
        promptsCache = { initial: defaultSystemPromptInitial, refine: defaultSystemPromptRefine, opening: defaultSystemPromptOpening, openingRefine: defaultSystemPromptOpeningRefine }; 
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
            return entries.map(e => ({ uid: e.uid, displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题", content: e.content || "", enabled: e.enabled }));
        } catch (e) { }
    }
    return [];
}

// [Updated] Generation Logic supporting all modes
async function runGeneration(data, apiConfig) {
    const context = getContext();
    const charId = context.characterId;
    const charName = (charId !== undefined) ? context.characters[charId].name : "None";
    const currentName = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";

    if (!promptsCache || !promptsCache.initial) loadData(); 

    // Context preparation
    const charInfoText = getCharacterInfoText();

    let systemTemplate = promptsCache.initial;
    if (data.mode === 'refine') systemTemplate = promptsCache.refine;
    if (data.mode === 'opening') systemTemplate = promptsCache.opening;
    if (data.mode === 'opening_refine') systemTemplate = promptsCache.openingRefine;

    let systemPrompt = systemTemplate
        .replace(/{{user}}/g, currentName)
        .replace(/{{char}}/g, charName)
        .replace(/{{charInfo}}/g, charInfoText)
        .replace(/{{greetings}}/g, data.greetingsText || "")
        .replace(/{{wi}}/g, data.wiText || "")
        .replace(/{{tags}}/g, currentTemplate)
        .replace(/{{input}}/g, data.request)
        .replace(/{{current}}/g, data.currentText || "")
        // New variables for opening generation
        .replace(/{{userPersona}}/g, data.userPersona || "")
        .replace(/{{charPersona}}/g, data.charPersona || "");

    let responseContent = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); 

    try {
        if (apiConfig.apiSource === 'independent') {
            let baseUrl = apiConfig.indepApiUrl.replace(/\/$/, '');
            if (baseUrl.endsWith('/chat/completions')) baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
            const url = `${baseUrl}/chat/completions`;
            const messages = [{ role: 'system', content: systemPrompt }];
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
            if (window.TavernHelper && typeof window.TavernHelper.generateRaw === 'function') {
                console.log("[PW] Using TavernHelper.generateRaw");
                responseContent = await window.TavernHelper.generateRaw({
                    user_input: '',
                    ordered_prompts: [{ role: 'system', content: systemPrompt }],
                    overrides: {
                        chat_history: { prompts: [] },
                        world_info_before: '',
                        world_info_after: '',
                        persona_description: '',
                        char_description: '',
                        char_personality: '',
                        scenario: '',
                        dialogue_examples: ''
                    }
                });
            } else if (typeof context.generateQuietPrompt === 'function') {
                console.log("[PW] Using context.generateQuietPrompt (Legacy)");
                responseContent = await context.generateQuietPrompt(systemPrompt, false, false, null, "System");
            } else {
                throw new Error("ST版本过旧或未安装 TavernHelper，不支持主API生成");
            }
        }
    } finally { clearTimeout(timeoutId); }
    
    lastRawResponse = responseContent;
    
    // Opening mode returns raw text (contains ``` blocks), others return cleaned text
    if (data.mode === 'opening') return responseContent;
    
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
            <div class="pw-tab" data-tab="opening">开场白</div>
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

    <!-- Opening Scene View -->
    <div id="pw-view-opening" class="pw-view">
        <div class="pw-scroll-area">
            
            <div class="pw-input-label">附加要求</div>
            <textarea id="pw-opening-req" class="pw-textarea pw-auto-height" placeholder="在此输入场景、时间、地点等要求..."></textarea>
            <button id="pw-btn-gen-opening" class="pw-btn gen" style="margin-top:10px;">生成开场白</button>
            <div id="pw-opening-results" class="pw-opening-result-container"></div>
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

    <!-- [Updated] Context View Structure -->
    <div id="pw-view-context" class="pw-view">
        <div class="pw-scroll-area">
            
            <!-- Greetings Section -->
            <div class="pw-card-section">
                <div class="pw-row">
                    <label class="pw-section-label pw-label-gold">角色开场白</label>
                    <select id="pw-greetings-select" class="pw-input" style="flex:1; max-width:60%;">
                        <option value="">(不使用开场白)</option>
                    </select>
                </div>
                
                <!-- Persistent Toggle Button (Initially Hidden) -->
                <div id="pw-greetings-toggle-bar" class="pw-preview-toggle-bar" style="display:none;">
                    <i class="fa-solid fa-angle-up"></i> 收起预览
                </div>
                
                <!-- Textarea (Hidden/Shown by toggle) -->
                <textarea id="pw-greetings-preview"></textarea>
            </div>

            <!-- World Info Section -->
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

            <!-- [Updated] Prompt Editor Collapsible -->
            <div class="pw-card-section">
                <div class="pw-context-header" id="pw-prompt-header">
                    <span><i class="fa-solid fa-terminal"></i> Prompt 查看与编辑</span>
                    <i class="fa-solid fa-chevron-down arrow"></i>
                </div>
                <div id="pw-prompt-container" style="display:none; padding-top:10px;">
                    <div style="display:flex; justify-content:space-between;"><span class="pw-prompt-label">人设初始生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-initial" style="font-size:0.7em;">恢复默认</button></div>
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
                    
                    <div style="display:flex; justify-content:space-between; margin-top:15px;"><span class="pw-prompt-label">人设润色指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-refine" style="font-size:0.7em;">恢复默认</button></div>
                    <div class="pw-var-btns">
                        <div class="pw-var-btn" data-ins="{{char}}"><span>Char名</span><span class="code">{{char}}</span></div>
                        <div class="pw-var-btn" data-ins="{{charInfo}}"><span>角色设定</span><span class="code">{{charInfo}}</span></div>
                        <div class="pw-var-btn" data-ins="{{greetings}}"><span>开场白</span><span class="code">{{greetings}}</span></div>
                        <div class="pw-var-btn" data-ins="{{wi}}"><span>世界书内容</span><span class="code">{{wi}}</span></div>
                        <div class="pw-var-btn" data-ins="{{tags}}"><span>模版(必要)</span><span class="code">{{tags}}</span></div>
                        <div class="pw-var-btn" data-ins="{{current}}"><span>当前文本</span><span class="code">{{current}}</span></div>
                        <div class="pw-var-btn" data-ins="{{input}}"><span>润色意见</span><span class="code">{{input}}</span></div>
                    </div>
                    <textarea id="pw-prompt-refine" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.refine}</textarea>

                    <div style="display:flex; justify-content:space-between; margin-top:15px;"><span class="pw-prompt-label">开场白生成指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-opening" style="font-size:0.7em;">恢复默认</button></div>
                    <textarea id="pw-prompt-opening" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.opening}</textarea>

                    <div style="display:flex; justify-content:space-between; margin-top:15px;"><span class="pw-prompt-label">开场白润色指令 (System Prompt)</span><button class="pw-mini-btn" id="pw-reset-opening-refine" style="font-size:0.7em;">恢复默认</button></div>
                    <textarea id="pw-prompt-opening-refine" class="pw-textarea pw-auto-height" style="min-height:150px; font-size:0.85em;">${promptsCache.openingRefine}</textarea>

                    <div style="text-align:right; margin-top:5px;"><button id="pw-api-save" class="pw-btn primary" style="width:100%;">保存 Prompts</button></div>
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

    // --- Greetings Toggle Button Click ---
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

    // --- 复制功能 ---
    $(document).on('click.pw', '#pw-copy-persona', function() {
        const text = $('#pw-result-text').val();
        if(!text) return toastr.warning("没有内容可复制");
        navigator.clipboard.writeText(text);
        toastr.success("人设已复制");
    });

    $(document).on('click.pw', '.pw-copy-opening-btn', function() {
        const text = $(this).closest('.pw-opening-card').find('.pw-opening-textarea').val();
        navigator.clipboard.writeText(text);
        toastr.success("开场白已复制");
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
            if (!activeEl || (!activeEl.id.startsWith('pw-result-text') && !activeEl.classList.contains('pw-opening-textarea'))) return;
            
            const hasSelection = activeEl.selectionStart !== activeEl.selectionEnd;
            const $btn = $('#pw-float-quote-btn');
            if (hasSelection) {
                if (!$btn.is(':visible')) $btn.stop(true, true).fadeIn(200).css('display', 'flex');
            } else {
                if ($btn.is(':visible')) $btn.stop(true, true).fadeOut(200);
            }
        }, 100);
    };
    $(document).on('touchend mouseup keyup', '.pw-opening-textarea, #pw-result-text', checkSelection);

    $(document).on('mousedown.pw', '#pw-float-quote-btn', function (e) {
        e.preventDefault(); 
        e.stopPropagation();
        
        const activeEl = document.activeElement;
        if (!activeEl) return;

        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const selectedText = activeEl.value.substring(start, end).trim();
        
        if (selectedText) {
            let $input;
            if (activeEl.id === 'pw-result-text') {
                $input = $('#pw-refine-input');
            } else if (activeEl.classList.contains('pw-opening-textarea')) {
                $input = $(activeEl).closest('.pw-opening-card').find('.pw-card-refine-input');
                $(activeEl).closest('.pw-opening-card').find('.pw-card-refine-box').slideDown();
            }

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
        
        // Handle Opening Refine diff view
        if ($('#pw-diff-overlay').data('source') === 'opening') {
            if (view === 'diff') { 
                $('#pw-diff-list-view').show();
                $('#pw-diff-raw-view').hide();
            } else { 
                $('#pw-diff-list-view').hide();
                $('#pw-diff-raw-view').show();
            }
        } else {
            // Handle Persona Refine diff view
            if (view === 'diff') {
                $('#pw-diff-list-view').show();
                $('#pw-diff-raw-view').hide();
            } else {
                $('#pw-diff-list-view').hide();
                $('#pw-diff-raw-view').css('display', 'flex');
                if (!$('#pw-diff-raw-textarea').val() && lastRawResponse) {
                    $('#pw-diff-raw-textarea').val(lastRawResponse);
                }
            }
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
        const source = $('#pw-diff-overlay').data('source');
        const activeTab = $('.pw-diff-tab.active').data('view');
        
        let finalContent = "";

        if (source === 'opening') {
            if (activeTab === 'diff') {
                finalContent = $('#pw-opening-old-textarea').val();
            } else {
                finalContent = $('#pw-opening-new-textarea').val();
            }
            if (currentRefiningCard) {
                currentRefiningCard.find('.pw-opening-textarea').val(finalContent);
                currentRefiningCard.find('.pw-card-refine-box').slideUp();
            }
        } else {
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
        }

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
            toastr.error("生成失败: " + e.message); 
        } finally { 
            $btn.prop('disabled', false).html('生成设定'); 
            isProcessing = false;
        }
    });

    // Generate Opening
    $(document).on('click.pw', '#pw-btn-gen-opening', async function(e) {
        e.preventDefault();
        console.log("[PW] Opening Gen Clicked");
        const req = $('#pw-opening-req').val();
        const $btn = $(this);
        
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 构思开场白中...');
        $('#pw-opening-results').empty();
        
        await forcePaint();

        try {
            const wiContent = await collectActiveWorldInfoContent();
            const charPersona = getCharacterPersonaString();
            const userPersona = $('#pw-result-text').val() || getActivePersonaDescription();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            
            const config = {
                mode: 'opening', request: req, wiContext: wiContent,
                charPersona: charPersona, userPersona: userPersona,
                apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), indepApiModel: modelVal
            };
            
            const rawText = await runGeneration(config, config);
            renderOpeningResults(rawText);
            
        } catch (e) {
            console.error(e);
            toastr.error("生成失败: " + e.message);
        } finally {
            $btn.prop('disabled', false).html('生成开场白');
        }
    });

    // Carousel Navigation
    $(document).on('click.pw', '#pw-prev-slide', () => { if (currentSlideIndex > 0) { currentSlideIndex--; updateCarousel(); } });
    $(document).on('click.pw', '#pw-next-slide', () => { if (currentSlideIndex < totalSlides - 1) { currentSlideIndex++; updateCarousel(); } });

    // Save Draft (Opening)
    $(document).on('click.pw', '.pw-save-draft-btn', function() {
        const content = $(this).closest('.pw-opening-card').find('.pw-opening-textarea').val();
        const req = $('#pw-opening-req').val();
        saveHistory({ 
            request: req || "开场白生成", 
            timestamp: new Date().toLocaleString(), 
            title: "", 
            data: { name: "Opening", resultText: content, type: 'opening' } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // Apply to Card (Opening)
    $(document).on('click.pw', '.apply-btn', async function() {
        const finalContent = $(this).closest('.pw-opening-card').find('.pw-opening-textarea').val();
        const context = getContext();
        if (context.characterId === undefined || context.characterId === null) {
            return toastr.warning("未打开角色卡，无法添加到开场白列表");
        }
        const char = context.characters[context.characterId];
        if (!char.data) char.data = {};
        if (!char.data.alternate_greetings) char.data.alternate_greetings = [];
        char.data.alternate_greetings.push(finalContent);
        await saveCharacterDebounced();
        toastr.success("已添加到角色卡开场白列表");
    });

    // Toggle Refine (Opening)
    $(document).on('click.pw', '.toggle-refine-btn', function() {
        $(this).closest('.pw-opening-card').find('.pw-card-refine-box').slideToggle();
    });

    // Confirm Refine (Opening)
    $(document).on('click.pw', '.refine-confirm-btn', async function() {
        console.log("[PW] Opening Refine Clicked");
        const $card = $(this).closest('.pw-opening-card');
        const refineInput = $card.find('.pw-card-refine-input').val();
        if(!refineInput) return toastr.warning("请输入要求");
        
        const oldContent = $card.find('.pw-opening-textarea').val();
        const btn = $(this);
        btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 处理中');
        
        try {
            const wiContent = await collectActiveWorldInfoContent();
            const charPersona = getCharacterPersonaString();
            const userPersona = $('#pw-result-text').val() || getActivePersonaDescription();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;

            const config = {
                mode: 'opening_refine', request: refineInput, currentText: oldContent,
                wiContext: wiContent, charPersona: charPersona, userPersona: userPersona,
                apiSource: $('#pw-api-source').val(), indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), indepApiModel: modelVal
            };
            
            const refinedText = await runGeneration(config, config);
            currentRefiningCard = $card;
            
            $('#pw-diff-overlay').data('source', 'opening');
            $('#pw-diff-raw-textarea').val(lastRawResponse);
            $('#pw-diff-list').empty();

            const oldTabHtml = `<textarea class="pw-diff-raw-textarea" id="pw-opening-old-textarea" spellcheck="false">${oldContent}</textarea>`;
            const newTabHtml = `<textarea class="pw-diff-raw-textarea" id="pw-opening-new-textarea" spellcheck="false">${refinedText}</textarea>`;
            
            // Reconfigure Tab labels for raw view only
            $('.pw-diff-tab[data-view="diff"] div:first-child').text('原版本');
            $('.pw-diff-tab[data-view="raw"] div:first-child').text('新版本');
            
            // Force RAW view for openings
            $('.pw-diff-tab[data-view="raw"]').addClass('active');
            $('.pw-diff-tab[data-view="diff"]').removeClass('active');
            $('#pw-diff-list-view').html(oldTabHtml).hide();
            $('#pw-diff-raw-view').html(newTabHtml).show();

            $('#pw-diff-overlay').fadeIn();
            $card.find('.pw-card-refine-input').val(''); 

        } catch(e) {
            console.error(e);
            toastr.error("润色失败: " + e.message);
        } finally {
            btn.prop('disabled', false).html('<i class="fa-solid fa-magic"></i> 确认润色');
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
            title: "", 
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
        promptsCache.opening = $('#pw-prompt-opening').val();
        promptsCache.openingRefine = $('#pw-prompt-opening-refine').val();
        saveData();
        toastr.success("设置与Prompt已保存");
    });

    $(document).on('click.pw', '#pw-reset-initial', () => {
        if (confirm("恢复初始生成Prompt？")) $('#pw-prompt-initial').val(defaultSystemPromptInitial);
    });
    $(document).on('click.pw', '#pw-reset-refine', () => {
        if (confirm("恢复润色Prompt？")) $('#pw-prompt-refine').val(defaultSystemPromptRefine);
    });
    $(document).on('click.pw', '#pw-reset-opening', () => {
        if (confirm("恢复开场白Prompt？")) $('#pw-prompt-opening').val(defaultSystemPromptOpening);
    });
    $(document).on('click.pw', '#pw-reset-opening-refine', () => {
        if (confirm("恢复开场白润色Prompt？")) $('#pw-prompt-opening-refine').val(defaultSystemPromptOpeningRefine);
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

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

jQuery(async () => {
    addPersonaButton(); // Try once immediately
    bindEvents(); // Standard event binding
    console.log("[PW] Persona Weaver Loaded (v2.9 Full Features)");
});
