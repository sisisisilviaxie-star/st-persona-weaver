import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup, getRequestHeaders } from "../../../../script.js";

// ============================================================================
// 1. 常量与配置
// ============================================================================

const extensionName = "st-persona-weaver";
const STORAGE_KEY_HISTORY = 'pw_history_v19';
const STORAGE_KEY_STATE = 'pw_state_v19'; 
const STORAGE_KEY_TAGS = 'pw_tags_v12';
const BUTTON_ID = 'pw_persona_tool_btn';

const defaultTags = [
    { name: "性别", value: "" },
    { name: "年龄", value: "" },
    { name: "MBTI", value: "" },
    { name: "职业", value: "" },
    { name: "阵营", value: "" },
    { name: "外貌", value: "" },
    { name: "性格", value: "" },
    { name: "关系", value: "" },
    { name: "XP", value: "" },
    { name: "秘密", value: "" }
];

const defaultSettings = {
    autoSwitchPersona: true,
    syncToWorldInfo: true,
    historyLimit: 50,
    apiSource: 'main', 
    indepApiUrl: 'https://api.openai.com/v1',
    indepApiKey: '',
    indepApiModel: 'gpt-3.5-turbo'
};

const TEXT = {
    PANEL_TITLE: "用户设定编织者 Pro",
    BTN_TITLE: "打开设定生成器",
    TOAST_API_OK: "API 连接成功",
    TOAST_API_ERR: "API 连接失败",
    TOAST_SAVE_API: "API 设置已保存",
    TOAST_SNAPSHOT: "已存入历史记录",
    TOAST_GEN_FAIL: "生成失败，请检查 API 设置",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book) => `已写入世界书: ${book}`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法同步保存条目"
};

let historyCache = [];
let tagsCache = [];
let availableWorldBooks = []; 
let isEditingTags = false; 

// ============================================================================
// 2. 核心数据工具函数
// ============================================================================

// 将文本解析为键值对 Map (处理多行 Value)
function parseTextToMap(text) {
    const map = new Map();
    if (!text) return map;
    
    const lines = text.split('\n');
    let currentKey = null;
    let buffer = [];

    lines.forEach(line => {
        // 尝试匹配 "Key: Value"
        // 简单正则：开头非空，中间有冒号
        const match = line.match(/^([^:]+):(.*)$/);
        if (match) {
            // 如果之前有 Key 在缓存，先存起来
            if (currentKey) {
                map.set(currentKey, buffer.join('\n').trim());
            }
            // 开始新 Key
            currentKey = match[1].trim();
            buffer = [match[2].trim()];
        } else {
            // 如果不是新 Key，归为上一行 (多行内容) 或者 杂项
            if (currentKey) {
                buffer.push(line.trim());
            } else if (line.trim()) {
                // 没有 Key 的孤儿行
                map.set(`Misc_${Math.random().toString(36).substr(2, 4)}`, line.trim());
            }
        }
    });
    // 存最后一个
    if (currentKey) {
        map.set(currentKey, buffer.join('\n').trim());
    }
    return map;
}

// ============================================================================
// 3. 存储与系统函数
// ============================================================================

function loadData() {
    try { historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { historyCache = []; }
    try { tagsCache = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS)) || defaultTags; } catch { tagsCache = defaultTags; }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tagsCache));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyCache));
}

function saveHistory(item) {
    const limit = extension_settings[extensionName]?.historyLimit || 50;
    historyCache.unshift(item);
    if (historyCache.length > limit) historyCache = historyCache.slice(0, limit);
    saveData();
}

function saveState(data) { localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data)); }
function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }

function injectStyles() {
    const styleId = 'persona-weaver-css-v18';
    if ($(`#${styleId}`).length) return;
}

async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;
    context.powerUserSettings.persona_selected = name;
    
    // UI Update
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    if ($nameInput.length) $nameInput.val(name).trigger('input').trigger('change');
    if ($descInput.length) $descInput.val(description).trigger('input').trigger('c
