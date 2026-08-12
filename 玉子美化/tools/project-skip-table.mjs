import process from 'node:process';
import { parseCliArgs, printCliResult, promptForMissing, skipProjectTable } from './project-lib.mjs';

const options = parseCliArgs(process.argv.slice(2), { boolean: ['resume', 'dry-run', 'json'] });
options.project ||= options._[0];
await promptForMissing(options, [
  { key: 'project', label: 'project.json 路径' },
  { key: 'table', label: '要跳过或恢复的 sheetKey/表名' },
]);
if (!options.resume) await promptForMissing(options, [{ key: 'reason', label: '明确跳过原因' }]);
const result = await skipProjectTable({
  projectFile: options.project,
  table: options.table,
  reason: options.reason || '',
  resume: Boolean(options.resume),
  dryRun: Boolean(options['dry-run']),
});
printCliResult({ ...result, message: `${result.dryRun ? '计划更新' : '已更新'}表状态：${result.table.tableName} → ${result.table.status}` }, { json: options.json });
