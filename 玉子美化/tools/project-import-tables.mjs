import process from 'node:process';
import { importProjectTables, parseCliArgs, printCliResult, promptForMissing } from './project-lib.mjs';

const options = parseCliArgs(process.argv.slice(2), { boolean: ['overwrite', 'dry-run', 'json'] });
options.project ||= options._[0];
options.input ||= options._[1];
await promptForMissing(options, [
  { key: 'project', label: 'project.json 路径' },
  { key: 'input', label: '完整 chatSheets JSON 路径' },
]);
const result = await importProjectTables({
  projectFile: options.project,
  inputFile: options.input,
  overwrite: Boolean(options.overwrite),
  dryRun: Boolean(options['dry-run']),
});
printCliResult({ ...result, message: `${result.dryRun ? '导入计划完成' : '已导入并拆分'}：${result.tableCount} 张表` }, { json: options.json });
