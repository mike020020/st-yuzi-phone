import process from 'node:process';
import { getProjectStatus, parseCliArgs, printCliResult, promptForMissing } from './project-lib.mjs';

const options = parseCliArgs(process.argv.slice(2), { boolean: ['refresh', 'confirm', 'dry-run', 'json'] });
options.project ||= options._[0];
await promptForMissing(options, [{ key: 'project', label: 'project.json 路径' }]);
const result = await getProjectStatus({
  projectFile: options.project,
  refresh: Boolean(options.refresh),
  confirm: Boolean(options.confirm),
  dryRun: Boolean(options['dry-run']),
});
const action = options.refresh
  ? (result.dryRun ? '刷新预检通过' : '已刷新')
  : options.confirm
    ? (result.dryRun ? '确认预检通过' : '已确认')
    : '状态';
printCliResult({ ...result, message: `项目 ${result.projectId}：${action}，${result.phase}` }, { json: options.json });
