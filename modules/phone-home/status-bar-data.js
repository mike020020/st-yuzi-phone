// modules/phone-home/status-bar-data.js

const GLOBAL_TABLE_NAME = '全局数据表';
const CALENDAR_TABLE_NAME = '小日历表';
const HEADER_CURRENT_TIME = '当前时间';
const HEADER_TODAY_RELATION = '与今天的关系';
const TODAY_RELATION_VALUE = '今天';

function findHeaderIndex(headers, name) {
    return Array.isArray(headers) ? headers.findIndex(h => String(h ?? '').trim() === name) : -1;
}

function readCell(row, index) {
    if (!Array.isArray(row) || index < 0) return '';
    return String(row[index] ?? '').trim();
}

function findRawSheetByName(rawData, tableName) {
    if (!rawData || typeof rawData !== 'object') return null;

    for (const sheet of Object.values(rawData)) {
        if (String(sheet?.name || '').trim() !== tableName) continue;
        if (!Array.isArray(sheet?.content)) return null;
        return sheet;
    }

    return null;
}

function readSheetHeaders(sheet) {
    const headers = sheet?.content?.[0];
    return Array.isArray(headers) ? headers : [];
}

export function resolveStatusBarData(rawData) {
    const result = {
        currentTime: null,
        weekday: null,
        dayStatus: null,
        weather: null,
        majorEvent: null
    };

    // 全局数据表 → 当前时间
    const globalTable = findRawSheetByName(rawData, GLOBAL_TABLE_NAME);
    if (globalTable) {
        const headers = readSheetHeaders(globalTable);
        const timeIndex = findHeaderIndex(headers, HEADER_CURRENT_TIME);
        const firstRow = globalTable.content[1];
        if (timeIndex >= 0 && Array.isArray(firstRow)) {
            const value = readCell(firstRow, timeIndex);
            if (value) result.currentTime = value;
        }
    }

    // 小日历表 → 今天行摘要
    const calendarTable = findRawSheetByName(rawData, CALENDAR_TABLE_NAME);
    if (calendarTable) {
        const headers = readSheetHeaders(calendarTable);
        const relationIndex = findHeaderIndex(headers, HEADER_TODAY_RELATION);
        if (relationIndex >= 0) {
            const content = calendarTable.content;
            let todayRow = null;
            for (let index = 1; index < content.length; index += 1) {
                const row = content[index];
                if (readCell(row, relationIndex) === TODAY_RELATION_VALUE) {
                    todayRow = row;
                    break;
                }
            }
            if (todayRow) {
                const weekdayVal = readCell(todayRow, findHeaderIndex(headers, '星期几'));
                const statusVal = readCell(todayRow, findHeaderIndex(headers, '状态'));
                const weatherVal = readCell(todayRow, findHeaderIndex(headers, '天气'));
                const eventVal = readCell(todayRow, findHeaderIndex(headers, '大事件'));

                if (weekdayVal) result.weekday = weekdayVal;
                if (statusVal) result.dayStatus = statusVal;
                if (weatherVal) result.weather = weatherVal;
                if (eventVal) result.majorEvent = eventVal;
            }
        }
    }

    return result;
}
