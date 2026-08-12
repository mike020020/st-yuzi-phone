const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const CHRONICLE_SQL_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation-sql.js');
const CALENDAR_SQL_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'small-calendar-derived-fields-sql.js');

function loadSqlite() {
    try {
        return require('node:sqlite');
    } catch {
        return null;
    }
}

function rebindDeclaredTables(sql, replacements) {
    return replacements.reduce((result, [logicalName, physicalName]) => result
        .replaceAll(`FROM ${logicalName}`, `FROM ${physicalName}`)
        .replaceAll(`UPDATE ${logicalName}`, `UPDATE ${physicalName}`), sql);
}

function readRows(db, sql) {
    return db.prepare(sql).all().map((row) => ({ ...row }));
}

function seedChronicle(db, tableNames) {
    db.exec(`
        CREATE TABLE ${tableNames.anchor} (
            row_id INTEGER PRIMARY KEY,
            cur_time TEXT NOT NULL
        );
        CREATE TABLE ${tableNames.chronicle} (
            row_id INTEGER PRIMARY KEY,
            time_span TEXT NOT NULL,
            today_relation TEXT
        );
        INSERT INTO ${tableNames.anchor} (row_id, cur_time) VALUES (1, '2024-03-15 12:00');
        INSERT INTO ${tableNames.chronicle} (row_id, time_span, today_relation) VALUES
            (1, '2024-03-15 08:00 ~ 2024-03-15 09:00', ''),
            (2, '2024-03-12 08:00 ~ 2024-03-12 09:00', ''),
            (3, '2024-03-17 08:00 ~ 2024-03-17 09:00', '旧值');
    `);
}

function seedCalendar(db, tableName) {
    db.exec(`
        CREATE TABLE ${tableName} (
            row_id INTEGER PRIMARY KEY,
            date_text TEXT NOT NULL,
            weekday_text TEXT,
            month_days INTEGER
        );
        INSERT INTO ${tableName} (row_id, date_text, weekday_text, month_days) VALUES
            (1, '2024-02-29', '', 0),
            (2, '2024-03-01', '旧值', 0);
    `);
}

async function main() {
    const sqlite = loadSqlite();
    if (!sqlite) {
        console.log('[跳过] 当前 Node 未提供 node:sqlite；SQL 字符串合同仍由其他检查覆盖');
        return;
    }

    const chronicle = await import(pathToFileURL(CHRONICLE_SQL_PATH).href);
    const calendar = await import(pathToFileURL(CALENDAR_SQL_PATH).href);

    const oldDb = new sqlite.DatabaseSync(':memory:');
    seedChronicle(oldDb, { anchor: 'global_state', chronicle: 'chronicle' });
    seedCalendar(oldDb, 'small_calendar_days');
    oldDb.exec(chronicle.buildChronicleTodayRelationUpdateSql());
    oldDb.exec(calendar.buildSmallCalendarDerivedFieldsUpdateSql());
    assert.deepStrictEqual(readRows(oldDb, 'SELECT row_id, today_relation FROM chronicle ORDER BY row_id'), [
        { row_id: 1, today_relation: '今天' },
        { row_id: 2, today_relation: '3天前' },
        { row_id: 3, today_relation: '后天' },
    ], '作者 DDL 表名环境必须按 row_id 写回对应纪要行');
    assert.deepStrictEqual(readRows(oldDb, 'SELECT row_id, weekday_text, month_days FROM small_calendar_days ORDER BY row_id'), [
        { row_id: 1, weekday_text: '星期四', month_days: 29 },
        { row_id: 2, weekday_text: '星期五', month_days: 31 },
    ], '作者 DDL 表名环境必须按 row_id 写回对应小日历行');
    oldDb.close();

    const reboundDb = new sqlite.DatabaseSync(':memory:');
    seedChronicle(reboundDb, { anchor: 'quanjushujubiao', chronicle: 'jiyaobiao' });
    seedCalendar(reboundDb, 'xiaorilibiao');
    const reboundChronicleSql = rebindDeclaredTables(chronicle.buildChronicleTodayRelationUpdateSql(), [
        ['global_state', 'quanjushujubiao'],
        ['chronicle', 'jiyaobiao'],
    ]);
    const reboundCalendarSql = rebindDeclaredTables(calendar.buildSmallCalendarDerivedFieldsUpdateSql(), [
        ['small_calendar_days', 'xiaorilibiao'],
    ]);
    assert.ok(!reboundChronicleSql.includes('chronicle.row_id'), '重绑定后的纪要 SQL 不得残留逻辑表名前缀');
    assert.ok(!reboundCalendarSql.includes('small_calendar_days.row_id'), '重绑定后的小日历 SQL 不得残留逻辑表名前缀');
    reboundDb.exec(reboundChronicleSql);
    reboundDb.exec(reboundCalendarSql);
    assert.deepStrictEqual(readRows(reboundDb, 'SELECT row_id, today_relation FROM jiyaobiao ORDER BY row_id'), [
        { row_id: 1, today_relation: '今天' },
        { row_id: 2, today_relation: '3天前' },
        { row_id: 3, today_relation: '后天' },
    ], '拼音物理表环境必须按 row_id 写回对应纪要行');
    assert.deepStrictEqual(readRows(reboundDb, 'SELECT row_id, weekday_text, month_days FROM xiaorilibiao ORDER BY row_id'), [
        { row_id: 1, weekday_text: '星期四', month_days: 29 },
        { row_id: 2, weekday_text: '星期五', month_days: 31 },
    ], '拼音物理表环境必须按 row_id 写回对应小日历行');
    reboundDb.close();

    console.log('[通过] 派生字段 SQL 在作者 DDL 表名与拼音物理表重绑定环境中均可真实执行并逐行写回');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
